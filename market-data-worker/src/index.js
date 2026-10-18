const SOURCE = "https://tcgcsv.com";
const CATEGORY_ID = 3;
const STATE_KEY = "metadata/import-state.json";
const MANIFEST_KEY = "metadata/latest.json";
const BATCH_SIZE = 8;
const USER_AGENT = "PokePrizePoolMarketData/1.0 (staging importer; contact: pokeprizepool.com)";
const HEADERS = { "User-Agent": USER_AGENT, "Accept": "application/json, text/plain, */*" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
async function getJson(url) {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status} for ${url}`);
  const body = await response.json();
  if (body?.success === false || !Array.isArray(body?.results)) throw new Error(`Unexpected TCGCSV response from ${url}`);
  return body.results;
}
async function getState(bucket) {
  const object = await bucket.get(STATE_KEY);
  if (!object) return { lastCheckedUtcDate: null, sourceUpdatedAt: null, snapshotDate: null, active: false, nextGroup: 0, groups: [] };
  try { return await object.json(); } catch { throw new Error("Import state file is unreadable; stopping to avoid overwriting progress."); }
}
async function putJson(bucket, key, value) {
  await bucket.put(key, JSON.stringify(value), { httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "no-store" } });
}
function parseSourceTimestamp(text) {
  const raw = String(text || "").trim(), date = new Date(raw);
  if (!raw || Number.isNaN(date.getTime())) throw new Error("TCGCSV last-updated marker did not contain a readable timestamp.");
  return { raw, date };
}
async function readMarker() {
  const response = await fetch(`${SOURCE}/last-updated.txt`, { headers: { "User-Agent": USER_AGENT, "Accept": "text/plain" } });
  if (!response.ok) throw new Error(`TCGCSV marker returned HTTP ${response.status}`);
  return parseSourceTimestamp(await response.text());
}
function validPrice(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
async function processGroup(bucket, group, snapshotDate, sourceUpdatedAt) {
  const base = `${SOURCE}/tcgplayer/${CATEGORY_ID}/${group.groupId}`;
  const [products, prices] = await Promise.all([getJson(`${base}/products`), getJson(`${base}/prices`)]);
  const pricesByProduct = new Map();
  for (const price of prices) {
    const key = String(price.productId);
    if (!pricesByProduct.has(key)) pricesByProduct.set(key, []);
    pricesByProduct.get(key).push({
      subtype: price.subTypeName || "Unspecified",
      marketPrice: validPrice(price.marketPrice), lowPrice: validPrice(price.lowPrice),
      midPrice: validPrice(price.midPrice), highPrice: validPrice(price.highPrice),
      directLowPrice: validPrice(price.directLowPrice)
    });
  }
  const rows = products.map(product => ({
    source: "tcgcsv_tcgplayer", categoryId: CATEGORY_ID, groupId: group.groupId,
    groupName: group.name || "", groupAbbreviation: group.abbreviation || "",
    productId: product.productId, productName: product.name || "", cleanName: product.cleanName || "",
    imageUrl: product.imageUrl || "", productUrl: product.url || "",
    extendedData: Array.isArray(product.extendedData) ? product.extendedData : [],
    prices: pricesByProduct.get(String(product.productId)) || [], snapshotDate, sourceUpdatedAt
  }));
  await putJson(bucket, `snapshots/${snapshotDate}/groups/${group.groupId}.json`, {
    schemaVersion: 1, source: "TCGCSV / TCGplayer", categoryId: CATEGORY_ID, group,
    snapshotDate, sourceUpdatedAt, importedAt: new Date().toISOString(), productCount: rows.length, rows
  });
  return { groupId: group.groupId, groupName: group.name, productCount: rows.length, pricedProducts: rows.filter(row => row.prices.length).length };
}
async function runBatch(env) {
  if (!env.MARKET_DATA) throw new Error("Missing R2 binding MARKET_DATA.");
  const bucket = env.MARKET_DATA, state = await getState(bucket), utcDate = new Date().toISOString().slice(0, 10);
  if (!state.active && state.lastCheckedUtcDate === utcDate) return { status: "idle", reason: "Already checked the source marker today.", checkedUtcDate: utcDate };
  if (!state.active) {
    const marker = await readMarker();
    state.lastCheckedUtcDate = utcDate;
    state.sourceUpdatedAt = marker.raw;
    state.snapshotDate = marker.date.toISOString().slice(0, 10);
    const previousObject = await bucket.get(MANIFEST_KEY);
    let previous = null;
    if (previousObject) { try { previous = await previousObject.json(); } catch {} }
    if (previous?.sourceUpdatedAt === marker.raw && previous?.status === "complete") {
      await putJson(bucket, STATE_KEY, state);
      return { status: "idle", reason: "No new TCGCSV source update since the last completed import.", sourceUpdatedAt: marker.raw };
    }
    state.groups = (await getJson(`${SOURCE}/tcgplayer/${CATEGORY_ID}/groups`)).filter(g => Number.isInteger(Number(g.groupId))).map(g => ({
      groupId: Number(g.groupId), name: g.name || "", abbreviation: g.abbreviation || "", categoryId: CATEGORY_ID,
      publishedOn: g.publishedOn || null, modifiedOn: g.modifiedOn || null
    }));
    state.nextGroup = 0; state.completedGroups = []; state.productCount = 0; state.failedGroups = [];
    state.active = true; state.startedAt = new Date().toISOString();
    await putJson(bucket, STATE_KEY, state);
    await putJson(bucket, `snapshots/${state.snapshotDate}/manifest.json`, {
      status: "in_progress", source: "TCGCSV / TCGplayer", categoryId: CATEGORY_ID,
      snapshotDate: state.snapshotDate, sourceUpdatedAt: state.sourceUpdatedAt, expectedGroups: state.groups.length,
      completedGroups: 0, startedAt: state.startedAt
    });
  }
  const batch = state.groups.slice(state.nextGroup, state.nextGroup + BATCH_SIZE);
  for (const group of batch) {
    try {
      const result = await processGroup(bucket, group, state.snapshotDate, state.sourceUpdatedAt);
      state.completedGroups.push(result); state.productCount += result.productCount;
    } catch (error) {
      state.failedGroups.push({ groupId: group.groupId, groupName: group.name, error: String(error?.message || error), failedAt: new Date().toISOString() });
    }
    state.nextGroup++;
    await putJson(bucket, STATE_KEY, state);
  }
  const complete = state.nextGroup >= state.groups.length, status = complete ? (state.failedGroups.length ? "complete_with_errors" : "complete") : "in_progress";
  const manifest = {
    status, source: "TCGCSV / TCGplayer", categoryId: CATEGORY_ID, snapshotDate: state.snapshotDate,
    sourceUpdatedAt: state.sourceUpdatedAt, expectedGroups: state.groups.length, processedGroups: state.nextGroup,
    successfulGroups: state.completedGroups.length, failedGroups: state.failedGroups,
    productCount: state.productCount, startedAt: state.startedAt, updatedAt: new Date().toISOString()
  };
  await putJson(bucket, `snapshots/${state.snapshotDate}/manifest.json`, manifest);
  if (complete) { state.active = false; state.finishedAt = new Date().toISOString(); await putJson(bucket, MANIFEST_KEY, manifest); }
  await putJson(bucket, STATE_KEY, state);
  return { ...manifest, batchSize: batch.length, nextGroup: state.nextGroup };
}
export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runBatch(env).then(result => console.log("Market data scheduled run:", JSON.stringify(result))).catch(error => console.error("Market data import failed:", error)));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, worker: "pokeprizepool-market-data-staging" });
    if (url.pathname !== "/admin/run") return json({ ok: false, error: "not_found" }, 404);
    if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
    const expected = env.ADMIN_TOKEN;
    if (!expected || request.headers.get("Authorization") !== `Bearer ${expected}`) return json({ ok: false, error: "unauthorized" }, 401);
    try { return json({ ok: true, result: await runBatch(env) }); }
    catch (error) { console.error("Manual market data run failed:", error); return json({ ok: false, error: "import_failed", message: String(error?.message || error) }, 500); }
  }
};
