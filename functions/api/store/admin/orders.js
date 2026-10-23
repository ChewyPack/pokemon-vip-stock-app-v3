import { json, wrap, readJson, requireAdmin, HttpError } from '../../../_lib/store.js';

const FULFILL = ['unfulfilled', 'processing', 'shipped', 'delivered', 'cancelled'];

// GET /api/store/admin/orders?q=&status=&id=
export const onRequestGet = wrap(async (ctx) => {
  await requireAdmin(ctx);
  const u = new URL(ctx.request.url), db = ctx.env.DB;
  const id = Number(u.searchParams.get('id'));
  if (Number.isInteger(id) && id > 0) {
    const order = await db.prepare('SELECT * FROM store_orders WHERE id = ?').bind(id).first();
    if (!order) throw new HttpError(404, 'Not found');
    const items = (await db.prepare('SELECT * FROM store_order_items WHERE order_id = ?').bind(id).all()).results;
    return json({ order, items });
  }
  const where = []; const args = [];
  const q = (u.searchParams.get('q') || '').trim().slice(0, 80);
  if (q) { where.push('(order_number LIKE ? OR email LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const st = u.searchParams.get('status');
  if (st) { where.push('(payment_status = ? OR fulfillment_status = ?)'); args.push(st, st); }
  const { results } = await db.prepare(`SELECT id, order_number, email, total_cents, payment_status, fulfillment_status, created_at FROM store_orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 200`).bind(...args).all();
  return json({ orders: results });
});

// PATCH /api/store/admin/orders?id=1  body: { fulfillmentStatus?, trackingCarrier?, trackingNumber? }
export const onRequestPatch = wrap(async (ctx) => {
  const actor = await requireAdmin(ctx);
  const id = Number(new URL(ctx.request.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id');
  const b = await readJson(ctx.request);
  const order = await ctx.env.DB.prepare('SELECT payment_status FROM store_orders WHERE id = ?').bind(id).first();
  if (!order) throw new HttpError(404, 'Not found');
  const sets = []; const args = [];
  if (b.fulfillmentStatus !== undefined) {
    if (!FULFILL.includes(b.fulfillmentStatus)) throw new HttpError(400, 'Invalid status');
    if (['shipped', 'delivered'].includes(b.fulfillmentStatus) && order.payment_status !== 'paid') throw new HttpError(409, 'Only paid orders can be shipped');
    sets.push('fulfillment_status = ?'); args.push(b.fulfillmentStatus);
  }
  if (b.trackingCarrier !== undefined) { sets.push('tracking_carrier = ?'); args.push(String(b.trackingCarrier).slice(0, 60)); }
  if (b.trackingNumber !== undefined) { sets.push('tracking_number = ?'); args.push(String(b.trackingNumber).slice(0, 80)); }
  if (!sets.length) throw new HttpError(400, 'Nothing to update');
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`UPDATE store_orders SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...args, id),
    ctx.env.DB.prepare('INSERT INTO store_audit_log (actor, action, detail) VALUES (?,?,?)').bind(actor, 'order.update', JSON.stringify({ id, ...b })),
  ]);
  return json({ ok: true });
});
