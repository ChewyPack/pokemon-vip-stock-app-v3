function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60, stale-while-revalidate=300'
    }
  });
}

function normalizeType(value) {
  const type = String(value || 'single').toLowerCase();
  if (type === 'sealed') return 'sealed';
  if (type === 'all') return 'all';
  // A graded listing still needs to resolve to the underlying raw card.
  if (type === 'graded') return 'single';
  return 'single';
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);

  const url = new URL(request.url);
  const mode = (url.searchParams.get('mode') || 'search').toLowerCase();

  try {
    const state = await env.DB.prepare(
      'SELECT source_timestamp, last_success_at, status FROM tcgcsv_sync_state WHERE id = 1'
    ).first();

    if (mode === 'sets') {
      const sets = await env.DB.prepare(
        'SELECT group_id AS id, name, abbreviation, published_on FROM tcgcsv_groups WHERE category_id = 3 ORDER BY name COLLATE NOCASE'
      ).all();
      return json({
        ok: true,
        sets: sets.results || [],
        source_timestamp: state?.source_timestamp || null,
        last_success_at: state?.last_success_at || null,
        synced: Boolean(state?.last_success_at)
      });
    }

    const query = (url.searchParams.get('q') || '').trim().slice(0, 80);
    if (query.length < 2) return json({ ok: true, products: [], source_timestamp: state?.source_timestamp || null });

    if (!state?.last_success_at) return json({ ok: false, error: 'tcgcsv_not_synced' }, 503);\n\n    const requestedType = normalizeType(url.searchParams.get('type'));
    const groupIdRaw = url.searchParams.get('set_id') || '';
    const groupId = /^\\d+$/.test(groupIdRaw) ? Number(groupIdRaw) : null;
    const limitRaw = Number(url.searchParams.get('limit') || 30);
    const limit = Number.isInteger(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : 30;
    const likeQuery = '%' + query + '%';

    let typeClause = '';
    const binds = [query, query, query, likeQuery];
    if (requestedType !== 'all') {
      typeClause = 'AND p.product_type = ?';
      binds.push(requestedType);
    }
    let setClause = '';
    if (groupId !== null) {
      setClause = 'AND p.group_id = ?';
      binds.push(groupId);
    }
    binds.push(limit);

    const rows = await env.DB.prepare(`
      SELECT
        p.product_id, p.name, p.clean_name, p.image_url, p.product_url,
        p.product_type, p.card_number, p.rarity, p.group_id,
        g.name AS set_name, g.abbreviation AS set_abbreviation,
        pr.subtype_name, pr.low_price, pr.mid_price, pr.high_price,
        pr.market_price, pr.direct_low_price, pr.last_seen_sync AS price_sync
      FROM (
        SELECT p.*
        FROM tcgcsv_products p
        WHERE p.category_id = 3
          AND (
            instr(lower(p.name), lower(?)) > 0
            OR instr(lower(COALESCE(p.clean_name, '')), lower(?)) > 0
            OR instr(lower(COALESCE(p.card_number, '')), lower(?)) > 0
            OR lower(p.name) LIKE lower(?)
          )
          ${typeClause}
          ${setClause}
        ORDER BY
          CASE WHEN lower(p.name) = lower(?) THEN 0
               WHEN instr(lower(p.name), lower(?)) = 1 THEN 1
               ELSE 2 END,
          p.name COLLATE NOCASE
        LIMIT ?
      ) p
      LEFT JOIN tcgcsv_groups g ON g.group_id = p.group_id
      LEFT JOIN tcgcsv_prices pr ON pr.product_id = p.product_id
      ORDER BY p.name COLLATE NOCASE, pr.subtype_name COLLATE NOCASE
    `).bind(
      ...binds.slice(0, 3),
      likeQuery,
      ...(requestedType !== 'all' ? [requestedType] : []),
      ...(groupId !== null ? [groupId] : []),
      query,
      likeQuery,
      limit
    ).all();

    const byId = new Map();
    for (const row of rows.results || []) {
      let product = byId.get(row.product_id);
      if (!product) {
        product = {
          id: String(row.product_id),
          tcgcsv_product_id: row.product_id,
          name: row.name,
          clean_name: row.clean_name || '',
          set_name: row.set_name || '',
          set_id: row.group_id,
          set_abbreviation: row.set_abbreviation || '',
          product_type: row.product_type,
          card_number: row.card_number || '',
          rarity: row.rarity || '',
          image_url: row.image_url || '',
          product_url: row.product_url || '',
          prices: [],
          market_price: null,
          market_price_subtype: null,
          price_updated_at: null
        };
        byId.set(row.product_id, product);
      }
      if (row.subtype_name) {
        const price = {
          subtype_name: row.subtype_name,
          low_price: row.low_price === null ? null : Number(row.low_price),
          mid_price: row.mid_price === null ? null : Number(row.mid_price),
          high_price: row.high_price === null ? null : Number(row.high_price),
          market_price: row.market_price === null ? null : Number(row.market_price),
          direct_low_price: row.direct_low_price === null ? null : Number(row.direct_low_price),
          price_updated_at: row.price_sync || null
        };
        product.prices.push(price);
        const preferred = String(row.subtype_name).toLowerCase() === 'normal' ? 0 :
          String(row.subtype_name).toLowerCase() === 'holofoil' ? 1 : 2;
        const current = product.market_price_subtype === null ? 99 :
          String(product.market_price_subtype).toLowerCase() === 'normal' ? 0 :
          String(product.market_price_subtype).toLowerCase() === 'holofoil' ? 1 : 2;
        if (price.market_price !== null && (product.market_price === null || preferred < current)) {
          product.market_price = price.market_price;
          product.market_price_subtype = price.subtype_name;
          product.price_updated_at = price.price_updated_at;
        }
      }
    }

    return json({
      ok: true,
      products: Array.from(byId.values()),
      source_timestamp: state?.source_timestamp || null,
      last_success_at: state?.last_success_at || null,
      synced: Boolean(state?.last_success_at)
    });
  } catch (error) {
    console.error('TCGCSV catalog search failed:', error);
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('no such table') || message.includes('no such column')) {
      return json({ ok: false, error: 'tcgcsv_migration_required' }, 503);
    }
    return json({ ok: false, error: 'catalog_search_failed' }, 500);
  }
}

export async function onRequest() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
