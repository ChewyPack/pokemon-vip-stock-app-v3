import { json, wrap, HttpError, readJson } from '../../_lib/store.js';
import { quoteStoreItems } from '../../_lib/store-order-pricing.js';

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
  if (Number(row?.request_count || 0) > 20) throw new HttpError(429, 'Too many order requests were submitted from this connection. Please try again later.');
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
  if (email && (email.length > 254 || email.indexOf('@') <= 0 || email.lastIndexOf('.') <= email.indexOf('@') + 1 || email.includes(' '))) throw new HttpError(400, 'Enter a valid email or leave it blank.');
  if (!env.DB) throw new HttpError(503, 'The store catalog is temporarily unavailable.');

  const from = clean(env.STORE_ORDER_FROM || env.RESEND_FROM || env.EMAIL_FROM || env.LINE_SERVICE_FROM || env.PASSWORD_RESET_FROM || 'PokePrizePool <noreply@send.pokeprizepool.com>', 250);
  if (!env.RESEND_API_KEY) throw new HttpError(503, 'Order email is not configured. Please contact pokeprizepool@gmail.com.');

  const quote = await quoteStoreItems(env.DB, env, data.items, data.destinationState);
  const textItems = quote.lines.map(line =>
    '- ' + line.name + (line.variantTitle ? ' — ' + line.variantTitle : '') +
    ' × ' + line.quantity + ' @ ' + dollars(line.unitPriceCents) + ' each = ' + dollars(line.lineTotalCents)
  );
  const taxDescription = quote.state === 'RI'
    ? (quote.taxCollectionEnabled ? 'Rhode Island sales tax (7%)' : 'Estimated Rhode Island sales tax (7%, collection not enabled)')
    : 'Rhode Island sales tax (not applicable to selected out-of-state destination)';
  const totalDescription = quote.taxCollectionEnabled
    ? 'Total including Rhode Island sales tax (separate shipping, if applicable, is confirmed separately): '
    : 'Estimated total including the estimated tax line (tax collection setup must be confirmed before collecting it; separate shipping, if applicable, is confirmed separately): ';
  const textBody = [
    'New PokePrizePool Store Order Request',
    '',
    'PokePrizePool username: ' + username,
    'Preferred payment method: ' + method,
    email ? 'Contact email: ' + email : '',
    'Destination: ' + (quote.state === 'RI' ? 'Rhode Island or pickup in Rhode Island' : 'Outside Rhode Island'),
    'Requested fulfillment: ' + quote.fulfillment,
    '',
    'Items:',
    ...textItems,
    '',
    'Product subtotal: ' + dollars(quote.subtotalCents),
    taxDescription + ': ' + dollars(quote.taxCents),
    totalDescription + dollars(quote.totalCents),
    '',
    'Payment instructions: Venmo/PayPal @pokeprizepool; Cash App $pokeprizepool; Zelle 4014459975.',
    'Payment note/memo must include PokePrizePool username: ' + username,
    '',
    quote.taxNotice,
    'Verify availability, shipping/pickup needs, and the amount before confirming or fulfilling this order. The email is an order request and is not proof of payment.'
  ].filter(line => line !== undefined).join('\n');
  const htmlItems = quote.lines.map(line =>
    '<li>' + escapeHtml(line.name) +
    (line.variantTitle ? ' — ' + escapeHtml(line.variantTitle) : '') +
    ' × ' + line.quantity + ' @ ' + escapeHtml(dollars(line.unitPriceCents)) +
    ' each = <strong>' + escapeHtml(dollars(line.lineTotalCents)) + '</strong></li>'
  ).join('');
  const html = '<h2>New PokePrizePool Store Order Request</h2>' +
    '<p><strong>Username:</strong> ' + escapeHtml(username) + '<br>' +
    '<strong>Preferred payment method:</strong> ' + escapeHtml(method) + '<br>' +
    (email ? '<strong>Contact email:</strong> ' + escapeHtml(email) + '<br>' : '') +
    '<strong>Destination:</strong> ' + escapeHtml(quote.state === 'RI' ? 'Rhode Island or pickup in Rhode Island' : 'Outside Rhode Island') + '<br>' +
    '<strong>Requested fulfillment:</strong> ' + escapeHtml(quote.fulfillment) + '</p>' +
    '<h3>Items</h3><ul>' + htmlItems + '</ul>' +
    '<p><strong>Product subtotal: ' + escapeHtml(dollars(quote.subtotalCents)) + '</strong><br>' +
    escapeHtml(taxDescription) + ': ' + escapeHtml(dollars(quote.taxCents)) + '<br><strong>' +
    escapeHtml(totalDescription) + escapeHtml(dollars(quote.totalCents)) + '</strong></p>' +
    '<p>Venmo/PayPal: @pokeprizepool<br>Cash App: $pokeprizepool<br>Zelle: 4014459975</p>' +
    '<p>Payment note/memo must include PokePrizePool username: ' + escapeHtml(username) + '</p>' +
    '<p>' + escapeHtml(quote.taxNotice) + '</p>' +
    '<p>Verify availability, fulfillment, and final amount before confirming. This request is not proof of payment.</p>';

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
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(502, 'The email service rejected the sending credentials or sender address. Please contact PokePrizePool so the Resend settings can be checked.');
    }
    if (response.status === 429) {
      throw new HttpError(503, 'The email service is temporarily rate-limited. Please wait a little and try again, or use Copy order details.');
    }
    throw new HttpError(502, 'Could not send your order request. Please try again or use Copy order details.');
  }
  const sent = await response.json().catch(() => ({}));
  return json({ ok: true, request_received: true, email_sent: true, email_id: clean(sent.id, 120), item_count: quote.lines.reduce((n, x) => n + x.quantity, 0), subtotal_cents: quote.subtotalCents, tax_cents: quote.taxCents, total_cents: quote.totalCents, tax_collection_enabled: quote.taxCollectionEnabled });
});

export async function onRequest() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
