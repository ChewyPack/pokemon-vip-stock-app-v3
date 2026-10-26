import { json, wrap, requireAdmin, HttpError, readJson } from '../../../_lib/store.js';

const API = 'https://api.printify.com/v1/';
const PRINTIFY_SHOP_ID = '29457813'; // The selected PokePrizePool Printify shop (not "My new store").

async function printify(env, path, options = {}) {
  const token = String(env.PRINTIFY_API_TOKEN || '').trim();
  if (!token) throw new HttpError(503, 'Printify API token is not configured for this environment');
  const response = await fetch(API + path, {
    method: options.method || 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      'User-Agent': 'PokePrizePool Store Integration',
      Accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  if (!response.ok) {
    console.error('Printify API request failed', response.status, path);
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(502, 'Printify rejected the token. Check that it is valid and has shops.read and products.read permissions.');
    }
    throw new HttpError(502, 'Printify could not complete the request. Please try again later.');
  }
  return response.json();
}

const slugify = (s) => String(s || 'printify-product').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 65) || 'printify-product';

function cleanOptions(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, 20).map((option) => ({
    name: String(option?.name || 'Option').slice(0, 80),
    type: String(option?.type || '').slice(0, 40),
    values: (Array.isArray(option?.values) ? option.values : []).slice(0, 250).map((value) => ({
      id: String(value?.id ?? ''),
      title: String(value?.title || value?.name || value?.id || '').slice(0, 100),
      colors: (Array.isArray(value?.colors) ? value.colors : []).filter((color) => typeof color === 'string').slice(0, 8),
    })).filter((value) => value.id && value.title),
  })).filter((option) => option.values.length);
}

function cleanVariants(raw) {
  return (Array.isArray(raw) ? raw : []).filter((v) => v && v.is_enabled && Number.isInteger(Number(v.id)) && Number(v.price) >= 0).slice(0, 1000).map((v) => ({
    id: Number(v.id),
    title: String(v.title || 'Standard').slice(0, 160),
    sku: String(v.sku || '').slice(0, 100),
    priceCents: Math.round(Number(v.price)),
    enabled: !!v.is_enabled,
    isAvailable: v.is_available !== false,
    optionIds: (Array.isArray(v.options) ? v.options : []).map((id) => String(id)),
  }));
}

function cleanImages(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((i) => i && typeof i.src === 'string' && /^https:\/\//i.test(i.src))
    .sort((a, b) => Number(!!b.is_default) - Number(!!a.is_default))
    .slice(0, 10).map((i) => i.src);
}

async function loadAllProducts(env) {
  const products = [];
  let lastPage = 1;
  for (let page = 1; page <= Math.min(100, lastPage); page++) {
    const result = await printify(env, `shops/${PRINTIFY_SHOP_ID}/products.json?page=${page}`);
    const data = Array.isArray(result?.data) ? result.data : Array.isArray(result) ? result : null;
    if (!data) throw new HttpError(502, 'Unexpected response from Printify products API');
    products.push(...data);
    const reported = Number(result?.last_page || result?.lastPage || 0);
    if (reported > 0) lastPage = Math.min(100, reported);
    else if (data.length < 10) break;
    if (!data.length) break;
  }
  if (products.length >= 1000) throw new HttpError(502, 'Printify catalog is unexpectedly large; import was stopped safely');
  return products;
}

async function assertSchema(db) {
  const tableColumns = async (table) => {
    const result = await db.prepare(`PRAGMA table_info(${table})`).all();
    return new Set((result.results || []).map((c) => c.name));
  };
  const p = await tableColumns('store_products');
  const i = await tableColumns('store_order_items');
  const o = await tableColumns('store_orders');
  const missing = [
    ...['printify_shop_id', 'printify_product_id', 'printify_blueprint_id', 'printify_print_provider_id', 'printify_options', 'printify_variants', 'printify_synced_at'].filter((c) => !p.has(c)).map((c) => 'store_products.' + c),
    ...['printify_shop_id', 'printify_product_id', 'printify_variant_id', 'printify_variant_title'].filter((c) => !i.has(c)).map((c) => 'store_order_items.' + c),
    ...['printify_status', 'printify_order_id', 'printify_error', 'printify_last_attempt_at', 'printify_submitted_at'].filter((c) => !o.has(c)).map((c) => 'store_orders.' + c),
  ];
  if (missing.length) throw new HttpError(503, 'Printify database fields are not installed yet. Apply migrations/0101_printify_store.sql to the production pokemon-vip-members D1 database, then retry.');
}

// Admin-only connection check and catalog sync.
// GET /api/store/admin/printify -> list shops
// GET /api/store/admin/printify?shop_id=29457813 -> preview one product page
// POST /api/store/admin/printify { "action": "sync" } -> sync PokePrizePool products as unpublished drafts
export const onRequestGet = wrap(async (ctx) => {
  await requireAdmin(ctx);
  const { request, env } = ctx;
  const url = new URL(request.url);
  const shopId = (url.searchParams.get('shop_id') || '').trim();

  if (!env.PRINTIFY_API_TOKEN) throw new HttpError(503, 'Printify API token is not configured for this environment');

  if (!shopId) {
    const shops = await printify(env, 'shops.json');
    if (!Array.isArray(shops)) throw new HttpError(502, 'Unexpected response from Printify shops API');
    return json({
      connected: true,
      selectedShopId: PRINTIFY_SHOP_ID,
      shops: shops.map((s) => ({
        id: String(s.id),
        title: String(s.title || 'Untitled shop').slice(0, 160),
        salesChannel: String(s.sales_channel || 'disconnected').slice(0, 80),
      })),
    });
  }

  if (!/^\d{1,20}$/.test(shopId)) throw new HttpError(400, 'Invalid shop ID');
  const page = Math.max(1, Math.min(100, Number(url.searchParams.get('page') || 1) || 1));
  const result = await printify(env, `shops/${shopId}/products.json?page=${page}`);
  const products = Array.isArray(result?.data) ? result.data : Array.isArray(result) ? result : null;
  if (!products) throw new HttpError(502, 'Unexpected response from Printify products API');
  return json({
    connected: true,
    shopId,
    page,
    currentPage: result.current_page || page,
    lastPage: result.last_page || null,
    total: result.total || null,
    products: products.slice(0, 100).map((p) => ({
      id: String(p.id),
      title: String(p.title || 'Untitled product').slice(0, 200),
      description: String(p.description || '').slice(0, 3000),
      visible: !!p.visible,
      options: cleanOptions(p.options),
      variants: cleanVariants(p.variants),
      images: cleanImages(p.images),
    })),
  });
});

export const onRequestPost = wrap(async (ctx) => {
  const actor = await requireAdmin(ctx);
  const { env } = ctx;
  const body = await readJson(ctx.request, 5000);
  if (body.action !== 'sync') throw new HttpError(400, 'Unsupported Printify action');
  if (!env.PRINTIFY_API_TOKEN) throw new HttpError(503, 'Printify API token is not configured for this environment');
  await assertSchema(env.DB);

  // Verify the selected shop still exists and is exactly the intended PokePrizePool shop.
  const shops = await printify(env, 'shops.json');
  if (!Array.isArray(shops) || !shops.some((s) => String(s.id) === PRINTIFY_SHOP_ID && String(s.title).trim() === 'PokePrizePool')) {
    throw new HttpError(409, 'The selected PokePrizePool Printify shop was not found. No products were changed.');
  }

  const all = await loadAllProducts(env);
  const normalized = all.map((p) => ({
    source: p,
    id: String(p?.id || ''),
    name: String(p?.title || '').trim().slice(0, 200),
    variants: cleanVariants(p?.variants),
    options: cleanOptions(p?.options),
    images: cleanImages(p?.images),
  })).filter((p) => p.id && p.name);
  const candidates = normalized.filter((p) => p.variants.length);
  const unavailable = normalized.filter((p) => !p.variants.length);
  const db = env.DB;
  let created = 0, updated = 0, skipped = 0, deactivated = 0;

  // If a previously imported product no longer has enabled variants, stop offering it.
  for (const p of unavailable) {
    const existing = await db.prepare('SELECT id FROM store_products WHERE printify_shop_id = ? AND printify_product_id = ?')
      .bind(PRINTIFY_SHOP_ID, p.id).first();
    if (!existing) { skipped++; continue; }
    await db.prepare(`UPDATE store_products SET active=0, printify_options=?, printify_variants='[]',
      printify_synced_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
      .bind(JSON.stringify(p.options), existing.id).run();
    updated++;
    deactivated++;
  }

  for (const p of candidates) {
    const prices = p.variants.map((v) => v.priceCents).filter((n) => Number.isInteger(n) && n >= 0);
    if (!prices.length) { skipped++; continue; }
    const price = Math.min(...prices);
    const productSku = `PFY-${PRINTIFY_SHOP_ID}-${p.id}`.slice(0, 60);
    const src = p.source;
    const blueprintId = src.blueprint_id == null || src.blueprint_id === '' ? null : (Number.isInteger(Number(src.blueprint_id)) ? Number(src.blueprint_id) : null);
    const providerId = src.print_provider_id == null || src.print_provider_id === '' ? null : (Number.isInteger(Number(src.print_provider_id)) ? Number(src.print_provider_id) : null);
    const variantsJson = JSON.stringify(p.variants);
    const optionsJson = JSON.stringify(p.options);
    const imagesJson = JSON.stringify(p.images);
    const existing = await db.prepare('SELECT id, slug FROM store_products WHERE printify_shop_id = ? AND printify_product_id = ?')
      .bind(PRINTIFY_SHOP_ID, p.id).first();
    if (existing) {
      await db.prepare(`UPDATE store_products SET name=?, description=?, sku=?, category='merch', product_type='Printify merchandise',
        price_cents=?, inventory=0, images=?, printify_blueprint_id=?, printify_print_provider_id=?,
        printify_options=?, printify_variants=?, printify_synced_at=datetime('now'), updated_at=datetime('now')
        WHERE id=?`)
        .bind(p.name, String(src.description || '').slice(0, 5000), productSku, price, imagesJson, blueprintId, providerId, optionsJson, variantsJson, existing.id).run();
      updated++;
    } else {
      let slug = slugify(p.name);
      const conflict = await db.prepare('SELECT id FROM store_products WHERE slug = ?').bind(slug).first();
      if (conflict) slug = `${slug.slice(0, 55)}-${p.id.replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase()}`.slice(0, 80);
      await db.prepare(`INSERT INTO store_products
        (slug,name,description,sku,category,product_type,price_cents,inventory,active,preorder,coming_soon,images,
         printify_shop_id,printify_product_id,printify_blueprint_id,printify_print_provider_id,printify_options,printify_variants,printify_synced_at)
        VALUES (?,?,?,?,?,'Printify merchandise',?,0,0,0,0,?,?,?,?,?,?,?,datetime('now'))`)
        .bind(slug,p.name,String(src.description || '').slice(0,5000),productSku,'merch',price,imagesJson,PRINTIFY_SHOP_ID,p.id,blueprintId,providerId,optionsJson,variantsJson).run();
      created++;
    }
  }

  await db.prepare('INSERT INTO store_audit_log (actor, action, detail) VALUES (?,?,?)')
    .bind(actor, 'printify.catalog_sync', JSON.stringify({ shopId: PRINTIFY_SHOP_ID, totalFound: all.length, candidates: candidates.length, created, updated, skipped, deactivated })).run();
  return json({ ok: true, shopId: PRINTIFY_SHOP_ID, totalFound: all.length, imported: candidates.length, created, updated, skipped, deactivated, published: 0,
    message: 'Products are imported as unpublished drafts. They are not yet for sale; finish variant checkout, shipping, and fulfillment verification before publishing.' });
});
