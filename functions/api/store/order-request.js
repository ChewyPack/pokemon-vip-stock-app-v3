import { json, wrap, HttpError, readJson } from '../../_lib/store.js';
import { isBlockedPrintifyProductTitle, parseVariants } from '../../_lib/printify.js';

const DESTINATION = 'pokeprizepool@gmail.com';
const METHODS = new Set(['Venmo', 'PayPal', 'Zelle', 'Cash App']);
const clean = (v, max = 500) => String(v ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
const dollars = (cents) => '$' + (Number(cents || 0) / 100).toFixed(2);
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function enforceEmailRateLimit(db, request) {
  const ip = clean(request.headers.get('CF-Connecting-IP') || 'unknown', 120);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  const ipHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - 3600;
  await db.prepare('CREATE TABLE IF NOT EXISTS store_order_email_rate_limits (ip_hash TEXT PRIMARY KEY, window_started INTEGER NOT NULL, request_count INTEGER NOT NULL)').run();
  await db.prepare(`INSERT INTO store_order_email_rate_limits (ip_hash, window_started, request_count) VALUES (?, ?, 1)
    ON CONFLICT(ip_hash) DO UPDATE SET
      request_count = CASE WHEN window_started <= ? THEN 1 ELSE request_count + 1 END,
      window_started = CASE WHEN window_started <= ? THEN ? ELSE window_started END`)
    .bind(ipHash, now, windowStart, windowStart, now).run();
  const row = await db.prepare('SELECT request_count FROM store_order_email_rate_limits WHERE ip_hash = ?').bind(ipHash).first();
  if (Number(row?.request_count || 0) > 5) throw new HttpError(429, 'Too many order requests were submitted from this connection. Please try again later.');
  await db.prepare('DELETE FROM store_order_email_rate_limits WHERE window_started < ?').bind(now - 7 * 24 * 3600).run();
}

export const onRequestPost = wrap(async ({ request, env }) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'Use the PokePrizePool website to submit this request.');
  const data = await readJson(request, 25000);
  if (clean(data.website, 200)) return json({ ok: true, request_received: true }, 202);

  const username = clean(data.username, 24);
  const method = clean(data.paymentMethod, 30);
  const email = clean(data.email, 254).toLowerCase();
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) throw new HttpError(400, 'Enter your PokePrizePool username.');
  if (!METHODS.has(method)) throw new HttpError(400, 'Choose a payment method.');
  if (email && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email or leave it blank.');
  if (!env.DB) throw new HttpError(503, 'The store catalog is temporarily unavailable.');

  const from = clean(env.STORE_ORDER_FROM || env.LINE_SERVICE_FROM || env.PASSWORD_RESET_FROM, 250);
  if (!env.RESEND_API_KEY || !from) throw new HttpError(503, 'Order email is not configured. Please contact pokeprizepool@gmail.com.');
  if (!Array.isArray(data.items) || !data.items.length || data.items.length > 25) throw new HttpError(400, 'Your cart is empty or too large.');

  const wanted = new Map();
  for (const item of data.items) {
    const productId = Number(item?.productId);
    const variantId = item?.variantId == null || item.variantId === '' ? null : Number(item.variantId);
    const quantity = Number(item?.quantity);
    if (!Number.isSafeInteger(productId) || productId < 1 || (variantId !== null && (!Number.isSafeInteger(variantId) || variantId < 1)) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) throw new HttpError(400, 'One of the cart items has invalid details.');
    const key = productId + ':' + (variantId == null ? '' : variantId);
    const combined = (wanted.get(key)?.quantity || 0) + quantity;
    if (combined > 20) throw new HttpError(400, 'You can request up to 20 of each item.');
    wanted.set(key, { productId, variantId, quantity: combined });
  }

  const ids = [...new Set([...wanted.values()].map(x => x.productId))];
  const result = await env.DB.prepare('SELECT * FROM store_products WHERE id IN (' + ids.map(() => '?').join(',') + ')').bind(...ids).all();
  const byId = new Map((result.results || []).map(row => [Number(row.id), row]));
  const lines = [];
  let subtotal = 0;
  for (const item of wanted.values()) {
    const p = byId.get(item.productId);
    if (!p || Number(p.active) !== 1 || isBlockedPrintifyProductTitle(p.name)) throw new HttpError(409, 'An item is no longer available. Refresh the store and try again.');
    if (Number(p.coming_soon) === 1) throw new HttpError(409, 'A product in your cart is coming soon and cannot be ordered yet.');
    const printify = Boolean(p.printify_shop_id && p.printify_product_id);
    let price, option = '';
    if (printify) {
      if (item.variantId == null) throw new HttpError(400, 'Choose a size/color for each apparel item.');
      const variant = parseVariants(p.printify_variants).find(v => Number(v.id) === item.variantId && v.enabled !== false && v.isAvailable !== false && Number.isSafeInteger(Number(v.priceCents)) && Number(v.priceCents) >= 0);
      if (!variant) throw new HttpError(409, 'A selected size/color is no longer available.');
      price = Number(variant.priceCents); option = clean(variant.title || '', 100);
    } else {
      if (item.variantId != null) throw new HttpError(400, 'An item has an invalid option.');
      if (Number(p.inventory) < item.quantity) throw new HttpError(409, 'Not enough listed stock for ' + clean(p.name, 100) + '.');
      price = Number(p.price_cents);
      if (!Number.isSafeInteger(price) || price < 0) throw new HttpError(409, 'An item price needs review.');
    }
    const total = price * item.quantity;
    subtotal += total;
    lines.push({ name: clean(p.name, 150), option, quantity: item.quantity, price, total, category: clean(p.category, 50), printify });
  }

  const apparel = lines.some(x => x.printify || x.category.toLowerCase() === 'merch');
  const pickup = lines.some(x => !x.printify && x.category.toLowerCase() !== 'merch');
  const fulfillment = apparel && pickup ? 'Mixed cart — confirm shipping/pickup separately' : apparel ? 'Clothing/apparel shipping requested' : 'Pickup requested';
  const itemText = lines.map(x => '- ' + x.name + (x.option ? ' — ' + x.option : '') + ' × ' + x.quantity + ' @ ' + dollars(x.price) + ' each = ' + dollars(x.total));
  const textBody = [
    'New PokePrizePool Store Order Request', '',
    'PokePrizePool username: ' + username,
    'Preferred payment method: ' + method,
    email ? 'Contact email: ' + email : '',
    'Requested fulfillment: ' + fulfillment, '',
    'Items:', ...itemText, '',
    'Estimated product subtotal (not final): ' + dollars(subtotal), '',
    'Customer should put their PokePrizePool username in the payment note/memo.',
    'Verify availability, any taxes/shipping, and the final total. This email is an order request, not proof of payment.'
  ].filter(Boolean).join('\\n');
  const htmlItems = lines.map(x => '<li>' + escapeHtml(x.name) + (x.option ? ' — ' + escapeHtml(x.option) : '') + ' × ' + x.quantity + ' @ ' + escapeHtml(dollars(x.price)) + ' each = <strong>' + escapeHtml(dollars(x.total)) + '</strong></li>').join('');
  const html = '<h2>New PokePrizePool Store Order Request</h2><p><strong>Username:</strong> ' + escapeHtml(username) + '<br><strong>Payment method:</strong> ' + escapeHtml(method) + '<br>' + (email ? '<strong>Contact email:</strong> ' + escapeHtml(email) + '<br>' : '') + '<strong>Fulfillment:</strong> ' + escapeHtml(fulfillment) + '</p><h3>Items</h3><ul>' + htmlItems + '</ul><p><strong>Estimated subtotal (not final): ' + escapeHtml(dollars(subtotal)) + '</strong></p><p>Customer should put their PokePrizePool username in the payment note/memo. Verify the final total before confirming. This request is not proof of payment.</p>';

  const payload = { from, to: [DESTINATION], subject: 'PokePrizePool Store Order Request — ' + username, text: textBody, html };
  if (email) payload.reply_to = email;
  await enforceEmailRateLimit(env.DB, request);

  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error('Store order email could not reach Resend:', String(e?.message || e).slice(0, 120));
    throw new HttpError(502, 'Could not send your order request. Please try again or contact pokeprizepool@gmail.com.');
  }
  if (!response.ok) {
    console.error('Resend rejected a store order email:', response.status);
    throw new HttpError(502, 'Could not send your order request. Please try again or contact pokeprizepool@gmail.com.');
  }
  const sent = await response.json().catch(() => ({}));
  return json({ ok: true, request_received: true, email_sent: true, email_id: clean(sent.id, 120), item_count: lines.reduce((n, x) => n + x.quantity, 0), estimated_subtotal_cents: subtotal });
});

export async function onRequest() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
