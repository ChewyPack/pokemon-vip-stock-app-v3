import { json, wrap, publicProduct } from '../../_lib/store.js';

// GET /api/store/products?q=&category=&availability=in|pre&min=&max=&sort=new|lo|hi&page=1&slug=
export const onRequestGet = wrap(async ({ request, env }) => {
  const u = new URL(request.url);
  const where = ['active = 1']; const args = [];
  const slug = u.searchParams.get('slug');
  if (slug) { where.push('slug = ?'); args.push(slug); }
  const q = (u.searchParams.get('q') || '').trim().slice(0, 80);
  if (q) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    where.push('(name LIKE ? OR set_name LIKE ? OR sku LIKE ? OR category LIKE ?)');
    args.push(like, like, like, like);
  }
  const cat = u.searchParams.get('category');
  if (cat === 'preorder') where.push('preorder = 1');
  else if (cat) { where.push('category = ?'); args.push(cat); }
  const av = u.searchParams.get('availability');
  if (av === 'in') where.push('(inventory > 0 OR (external_checkout_url IS NOT NULL AND external_checkout_url != \'\')) AND preorder = 0');
  if (av === 'pre') where.push('preorder = 1');
  const min = parseInt(u.searchParams.get('min') || '', 10), max = parseInt(u.searchParams.get('max') || '', 10);
  if (Number.isInteger(min)) { where.push('price_cents >= ?'); args.push(min); }
  if (Number.isInteger(max)) { where.push('price_cents <= ?'); args.push(max); }
  const order = { lo: 'price_cents ASC', hi: 'price_cents DESC' }[u.searchParams.get('sort')] || 'created_at DESC, id DESC';
  const page = Math.max(1, parseInt(u.searchParams.get('page') || '1', 10) || 1), size = 24;
  const sql = `FROM store_products WHERE ${where.join(' AND ')}`;
  const total = await env.DB.prepare(`SELECT COUNT(*) n ${sql}`).bind(...args).first('n');
  const { results } = await env.DB.prepare(`SELECT * ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...args, size, (page - 1) * size).all();
  return json({ products: results.map(publicProduct), total, page, pageSize: size });
});
