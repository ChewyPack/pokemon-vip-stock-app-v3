import { json, wrap, readJson, HttpError, stripe, randomId, orderNumber, assertStoreStripeMode } from '../../_lib/store.js';

// POST /api/store/checkout  body: { items: [{ productId, quantity }], email? }
// The client only says WHICH products and HOW MANY. Prices, stock and totals come from D1.
// Stock is reserved atomically when the order is created and released if the session expires or fails.
export const onRequestPost = wrap(async ({ request, env }) => {
  assertStoreStripeMode(env);
  const origin = new URL(request.url).origin;

  // Refuse to sell if shipping or tax are not configured, so no order is priced incorrectly.
  let shippingOptions;
  try { shippingOptions = JSON.parse(env.STORE_SHIPPING_OPTIONS || '[]'); } catch { shippingOptions = []; }
  if (!Array.isArray(shippingOptions) || !shippingOptions.length || shippingOptions.length > 10 || shippingOptions.some(o => !o || typeof o.name !== 'string' || !o.name.trim() || o.name.length > 80 || !Number.isInteger(Number(o.amountCents)) || Number(o.amountCents) < 0 || Number(o.amountCents) > 100000)) {
    throw new HttpError(503, 'Shipping is not configured');
  }
  const autoTax = env.STORE_TAX_MODE === 'stripe_automatic';
  if (!autoTax && env.STORE_TAX_MODE !== 'none_confirmed') throw new HttpError(503, 'Tax is not configured');

  const body = await readJson(request);
  const raw = Array.isArray(body.items) ? body.items : [];
  if (!raw.length || raw.length > 25) throw new HttpError(400, 'Cart is empty or too large');

  const want = new Map();
  for (const it of raw) {
    const id = Number(it?.productId), qty = Number(it?.quantity);
    if (!Number.isInteger(id) || id < 1 || !Number.isInteger(qty) || qty < 1 || qty > 20) throw new HttpError(400, 'Invalid cart item');
    const combinedQty = (want.get(id) || 0) + qty;
    if (combinedQty > 20) throw new HttpError(400, 'Invalid cart item quantity');
    want.set(id, combinedQty);
  }

  const ids = [...want.keys()];
  const { results: rows } = await env.DB.prepare(
    `SELECT id, name, sku, price_cents, inventory, active, coming_soon FROM store_products WHERE id IN (${ids.map(() => '?').join(',')})`
  ).bind(...ids).all();
  const byId = new Map(rows.map((r) => [r.id, r]));
  let subtotal = 0; const lines = [];
  for (const [id, qty] of want) {
    const p = byId.get(id);
    if (!p || !p.active) throw new HttpError(409, 'An item in your cart is no longer available');
    if (p.coming_soon) throw new HttpError(409, 'This product is coming soon and cannot be purchased yet');
    if (p.inventory < qty) throw new HttpError(409, `Only ${p.inventory} of "${p.name}" available`);
    lines.push({ p, qty }); subtotal += p.price_cents * qty;
  }

  const num = orderNumber(), token = randomId(16);
  const email = typeof body.email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email) ? body.email.slice(0, 200) : null;

  // One atomic batch: order + items + stock decrement. The CHECK (inventory >= 0) constraint makes
  // the whole batch roll back if a concurrent order took the last unit.
  const db = env.DB;
  const stmts = [db.prepare(
    `INSERT INTO store_orders (order_number, public_token, email, subtotal_cents, total_cents) VALUES (?,?,?,?,?)`
  ).bind(num, token, email, subtotal, subtotal)];
  for (const { p, qty } of lines) {
    stmts.push(db.prepare(
      `INSERT INTO store_order_items (order_id, product_id, name, sku, unit_price_cents, quantity, line_total_cents)
       VALUES ((SELECT id FROM store_orders WHERE order_number = ?), ?, ?, ?, ?, ?, ?)`
    ).bind(num, p.id, p.name, p.sku, p.price_cents, qty, p.price_cents * qty));
    stmts.push(db.prepare(
      `UPDATE store_products SET inventory = inventory - ?, updated_at = datetime('now') WHERE id = ? AND active = 1`
    ).bind(qty, p.id));
  }
  try { await db.batch(stmts); }
  catch (e) { throw new HttpError(409, 'Sorry, an item just sold out. Please review your cart.'); }

  const order = await db.prepare('SELECT id FROM store_orders WHERE order_number = ?').bind(num).first();
  try {
    const session = await stripe(env, 'checkout/sessions', {
      mode: 'payment', // one-time payment only. Never 'subscription'.
      client_reference_id: num,
      customer_email: email || undefined,
      success_url: `${origin}/store/order.html?n=${encodeURIComponent(num)}&t=${encodeURIComponent(token)}`,
      cancel_url: `${origin}/store.html?checkout=cancelled`,
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      metadata: { ppp_store_order_id: String(order.id), ppp_order_number: num },
      payment_intent_data: { metadata: { ppp_store_order_id: String(order.id) } },
      shipping_address_collection: { allowed_countries: (env.STORE_SHIP_COUNTRIES || 'US').split(',') },
      billing_address_collection: 'required',
      automatic_tax: autoTax ? { enabled: true } : undefined,
      line_items: lines.map(({ p, qty }, i) => ({
        quantity: qty,
        price_data: { currency: 'usd', unit_amount: p.price_cents, product_data: { name: p.name, ...(autoTax ? { tax_code: env.STORE_TAX_CODE || 'txcd_99999999' } : {}) }, ...(autoTax ? { tax_behavior: 'exclusive' } : {}) },
      })),
      shipping_options: shippingOptions.map((o) => ({
        shipping_rate_data: {
          type: 'fixed_amount', display_name: String(o.name),
          fixed_amount: { amount: Number(o.amountCents), currency: 'usd' },
          ...(autoTax ? { tax_behavior: 'exclusive', tax_code: env.STORE_SHIPPING_TAX_CODE || 'txcd_92010001' } : {}),
        },
      })),
    });
    await db.prepare('UPDATE store_orders SET stripe_session_id = ? WHERE id = ?').bind(session.id, order.id).run();
    return json({ url: session.url, orderNumber: num });
  } catch (e) {
    await releaseOrder(db, order.id, 'failed');
    throw e;
  }
});

// Mark a still-pending order closed and return its stock, exactly once.
export async function releaseOrder(db, orderId, status) {
  await db.batch([
    db.prepare(`UPDATE store_orders SET payment_status = ?, updated_at = datetime('now') WHERE id = ? AND payment_status = 'pending'`).bind(status, orderId),
    db.prepare(
      `UPDATE store_products SET inventory = inventory + COALESCE((SELECT SUM(quantity) FROM store_order_items WHERE order_id = ?1 AND product_id = store_products.id), 0)
       WHERE id IN (SELECT product_id FROM store_order_items WHERE order_id = ?1)
       AND EXISTS (SELECT 1 FROM store_orders WHERE id = ?1 AND payment_status = ?2 AND restocked = 0)`
    ).bind(orderId, status),
    db.prepare(`UPDATE store_orders SET restocked = 1 WHERE id = ? AND payment_status = ? AND restocked = 0`).bind(orderId, status),
  ]);
}
