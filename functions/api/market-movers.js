function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300, stale-while-revalidate=600" }
  });
}

function validPrice(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) > 0;
}

function change(current, previous) {
  if (!validPrice(current) || !validPrice(previous)) return null;
  return {
    previous_price: Number(previous),
    dollar_change: Number((Number(current) - Number(previous)).toFixed(2)),
    percent_change: Number((((Number(current) - Number(previous)) / Number(previous)) * 100).toFixed(2))
  };
}

function sortMovers(items, direction, field) {
  return items.filter(item => item[field] && Number.isFinite(item[field].percent_change))
    .sort((a, b) => direction === "up"
      ? b[field].percent_change - a[field].percent_change
      : a[field].percent_change - b[field].percent_change)
    .slice(0, 15);
}

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ ok: false, error: "database_not_configured" }, 500);
  try {
    const state = await env.DB.prepare(
      "SELECT source_timestamp, last_success_at, status, last_error FROM tcgcsv_sync_state WHERE id=1"
    ).first();
    const latest = await env.DB.prepare(
      "SELECT MAX(source_timestamp) AS source_timestamp FROM tcgcsv_price_history WHERE market_price IS NOT NULL"
    ).first();
    const sourceTimestamp = state?.source_timestamp || latest?.source_timestamp || null;
    if (!sourceTimestamp) {
      return json({
        ok: true, ready: false, reason: "history_not_started",
        message: "Daily price history begins with the next successful TCGCSV refresh.",
        sync: state || null, singles: { gainers: [], decliners: [] }, sealed: { gainers: [], decliners: [] }
      });
    }

    const parsed = Date.parse(sourceTimestamp);
    if (!Number.isFinite(parsed)) {
      return json({
        ok: true, ready: false, reason: "source_timestamp_unparseable",
        source_timestamp: sourceTimestamp,
        message: "The source timestamp is not a standard date; historical comparisons will appear once a valid dated snapshot is recorded.",
        singles: { gainers: [], decliners: [] }, sealed: { gainers: [], decliners: [] }
      });
    }
    const dayCutoff = new Date(parsed - 24 * 60 * 60 * 1000).toISOString();
    const weekCutoff = new Date(parsed - 7 * 24 * 60 * 60 * 1000).toISOString();

    async function loadCategory(type) {
      const rows = await env.DB.prepare(`
        SELECT p.product_id, p.name, p.clean_name, p.image_url, p.product_url,
               p.product_type, p.card_number, p.rarity, p.group_id,
               g.name AS set_name, cur.subtype_name,
               cur.source_timestamp, cur.market_price,
               (SELECT old.market_price FROM tcgcsv_price_history old
                WHERE old.product_id=p.product_id
                  AND old.subtype_name=current.subtype_name
                  AND old.source_timestamp <= ?
                  AND old.market_price IS NOT NULL
                ORDER BY old.source_timestamp DESC LIMIT 1) AS price_1d,
               (SELECT old.source_timestamp FROM tcgcsv_price_history old
                WHERE old.product_id=p.product_id
                  AND old.subtype_name=current.subtype_name
                  AND old.source_timestamp <= ?
                  AND old.market_price IS NOT NULL
                ORDER BY old.source_timestamp DESC LIMIT 1) AS timestamp_1d,
               (SELECT old.market_price FROM tcgcsv_price_history old
                WHERE old.product_id=p.product_id
                  AND old.subtype_name=current.subtype_name
                  AND old.source_timestamp <= ?
                  AND old.market_price IS NOT NULL
                ORDER BY old.source_timestamp DESC LIMIT 1) AS price_7d,
               (SELECT old.source_timestamp FROM tcgcsv_price_history old
                WHERE old.product_id=p.product_id
                  AND old.subtype_name=current.subtype_name
                  AND old.source_timestamp <= ?
                  AND old.market_price IS NOT NULL
                ORDER BY old.source_timestamp DESC LIMIT 1) AS timestamp_7d
        FROM tcgcsv_products p
        JOIN tcgcsv_groups g ON g.group_id=p.group_id
        JOIN tcgcsv_price_history current
          ON current.product_id=p.product_id
         AND current.source_timestamp=(
           SELECT MAX(h.source_timestamp) FROM tcgcsv_price_history h
           WHERE h.product_id=p.product_id AND h.market_price IS NOT NULL
         )
        WHERE p.category_id=3 AND p.product_type=? AND current.market_price > 0
        ORDER BY p.product_id
      `).bind(dayCutoff, dayCutoff, weekCutoff, weekCutoff, sourceTimestamp, type).all();

      const items = (rows.results || []).map(row => {
        const day = change(row.market_price, row.price_1d);
        const week = change(row.market_price, row.price_7d);
        return {
          product_id: Number(row.product_id),
          name: row.name,
          set_name: row.set_name || "",
          card_number: row.card_number || "",
          rarity: row.rarity || "",
          image_url: row.image_url || "",
          product_url: row.product_url || "",
          subtype_name: row.subtype_name || "Normal",
          current_price: Number(row.market_price),
          source_timestamp: row.source_timestamp,
          day,
          day_timestamp: row.timestamp_1d || null,
          week,
          week_timestamp: row.timestamp_7d || null
        };
      });
      return {
        tracked_with_history: items.length,
        gainers: sortMovers(items, "up", "day"),
        decliners: sortMovers(items, "down", "day"),
        weekly_gainers: sortMovers(items, "up", "week"),
        weekly_decliners: sortMovers(items, "down", "week")
      };
    }

    const [singles, sealed] = await Promise.all([loadCategory("single"), loadCategory("sealed")]);
    return json({
      ok: true,
      ready: true,
      source: "TCGCSV",
      source_timestamp: sourceTimestamp,
      last_sync_success_at: state?.last_success_at || null,
      sync_status: state?.status || "unknown",
      history_started_at: sourceTimestamp,
      history_note: "Comparisons require a prior saved snapshot at or before the comparison cutoff. Newly tracked products are excluded until comparable history exists.",
      windows: { daily_hours: 24, weekly_days: 7 },
      singles,
      sealed
    });
  } catch (error) {
    console.error("Market movers API failed:", error);
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("no such table") || message.includes("no such column")) {
      return json({ ok: false, error: "market_history_not_ready", message: "Market history storage is not ready yet." }, 503);
    }
    return json({ ok: false, error: "market_movers_failed" }, 500);
  }
}

export async function onRequest() {
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
