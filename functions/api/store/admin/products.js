import { json, wrap, readJson, requireAdmin, HttpError } from '../../../_lib/store.js';
import { printifyCommerceReady } from '../../../_lib/printify.js';

const CATS = ['sealed', 'singles', 'slabs', 'accessories', 'merch'];
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const int = (v, min = 0) => { const n = Number(v); if (!Number.isInteger(n) || n < min) throw new HttpError(400, 'Invalid number'); return n; };
const txt = (v, max = 500) => (v == null || v === '' ? null : String(v).slice(0, max));

function clean(b, partial) {
  const o = {};
  const set = (k, v) => { if (!partial || b[k] !== undefined) o[k] = v(); };
  set('name', () => { if (!b.name) throw new HttpError(400, 'Name required'); return txt(b.name, 200); });
  set('description', () => txt(b.description, 5000) || '');
  set('sku', () => txt(b.sku, 60));
  set('category', () => { if (!CATS.includes(b.category)) throw new HttpError(400, 'Invalid category'); return b.category; });
  for (const [k, c] of [['productType', 'product_type'], ['set', 'set_name'], ['language', 'language'], ['condition', 'condition'], ['gradeCompany', 'grade_company'], ['grade', 'grade'], ['releaseDate', 'release_date']]) {
    if (!partial || b[k] !== undefined) o[c] = txt(b[k], 120);
  }
  if (!partial || b.priceCents !== undefined) o.price_cents = int(b.priceCents);
  if (!partial || b.compareAtCents !== undefined) o.compare_at_cents = b.compareAtCents == null ? null : int(b.compareAtCents);
  set('inventory', () => int(b.inventory));
  set('active', () => (b.active ? 1 : 0));
  set('preorder', () => (b.preorder ? 1 : 0));
  if (!partial || b.comingSoon !== undefined) o.coming_soon = b.comingSoon ? 1 : 0;
  set('images', () => { const a = Array.isArray(b.images) ? b.images.filter((x) => typeof x === 'string' && x.startsWith('https://')).slice(0, 10) : []; return JSON.stringify(a); });
  if (!partial || b.externalUrl !== undefined) {
    const raw = String(b.externalUrl || '').trim();
    o.external_checkout_url = null;
    if (raw) {
      let parsed;
      try { parsed = new URL(raw); } catch { throw new HttpError(400, 'Enter a valid Printify product URL.'); }
      const host = parsed.hostname.toLowerCase();
      if (parsed.protocol !== 'https:' || !(host === 'printify.me' || host.endsWith('.printify.me'))) {
        throw new HttpError(400, 'Printify checkout URLs must use HTTPS on a printify.me domain.');
      }
      o.external_checkout_url = parsed.href.slice(0, 2000);
    }
  }
  if (o.compare_at_cents != null && o.price_cents != null && o.compare_at_cents <= o.price_cents) throw new HttpError(400, 'Sale price must be below compare-at price');
  return o;
}

async function ensureAuditTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS store_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();
}
const audit = (db, actor, action, detail) =>
  db.prepare('INSERT INTO store_audit_log (actor, action, detail) VALUES (?,?,?)').bind(actor, action, JSON.stringify(detail)).run();

export const onRequestGet = wrap(async (ctx) => {
  await requireAdmin(ctx);
  const { results } = await ctx.env.DB.prepare('SELECT * FROM store_products ORDER BY id DESC LIMIT 500').all();
  return json({ products: results, printifyCommerceReady: printifyCommerceReady(ctx.env) });
});

export const onRequestPost = wrap(async (ctx) => {
  const actor = await requireAdmin(ctx);
  await ensureAuditTable(ctx.env.DB);
  const b = await readJson(ctx.request, 50000), o = clean(b, false);
  if (o.external_checkout_url && o.category !== 'merch') throw new HttpError(400, 'Printify checkout links are only allowed for merchandise products.');
  o.slug = slugify(b.slug || b.name);
  try {
    const keys = Object.keys(o);
    const r = await ctx.env.DB.prepare(`INSERT INTO store_products (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).bind(...keys.map((k) => o[k])).run();
    await audit(ctx.env.DB, actor, 'product.create', { id: r.meta.last_row_id, name: o.name });
    return json({ id: r.meta.last_row_id, slug: o.slug }, 201);
  } catch (e) { throw new HttpError(409, 'Slug or SKU already exists'); }
});

// PATCH /api/store/admin/products?id=123   (partial update; set inventory, price, active, etc.)
export const onRequestPatch = wrap(async (ctx) => {
  const actor = await requireAdmin(ctx);
  await ensureAuditTable(ctx.env.DB);
  const id = int(new URL(ctx.request.url).searchParams.get('id'), 1);
  const o = clean(await readJson(ctx.request, 50000), true);
  const productColumns = await ctx.env.DB.prepare('PRAGMA table_info(store_products)').all();
  const hasPrintifyColumn = (productColumns.results || []).some((column) => column.name === 'printify_product_id');
  const existing = await ctx.env.DB.prepare(
    `SELECT category, external_checkout_url${hasPrintifyColumn ? ', printify_product_id' : ''} FROM store_products WHERE id = ?`
  ).bind(id).first();
  if (!existing) throw new HttpError(404, 'Not found');
  if (hasPrintifyColumn && existing.printify_product_id && o.active === 1 && !printifyCommerceReady(ctx.env)) {
    throw new HttpError(409, 'Printify products cannot be published until the three production safety flags are enabled.');
  }
  const finalCategory = o.category || existing.category;
  const finalExternalUrl = o.external_checkout_url !== undefined ? o.external_checkout_url : existing.external_checkout_url;
  if (finalExternalUrl && finalCategory !== 'merch') throw new HttpError(400, 'Printify checkout links are only allowed for merchandise products.');
  const keys = Object.keys(o);
  if (!keys.length) throw new HttpError(400, 'Nothing to update');
  try {
    const r = await ctx.env.DB.prepare(`UPDATE store_products SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...keys.map((k) => o[k]), id).run();
    if (!r.meta.changes) throw new HttpError(404, 'Not found');
  } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(409, 'Update rejected (duplicate SKU or invalid value)'); }
  await audit(ctx.env.DB, actor, 'product.update', { id, fields: keys });
  return json({ ok: true });
});
