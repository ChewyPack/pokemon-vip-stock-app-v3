const COOKIE = 'collector_session';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
function getCookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const value = part.trim();
    if (value.startsWith(name + '=')) return value.slice(name.length + 1);
  }
  return '';
}
function b64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
}
async function sha256(value) {
  return b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
async function currentAccount(request, env) {
  const token = getCookie(request, COOKIE);
  if (!token) return null;
  const account = await env.DB.prepare(
    'SELECT id, session_expires_at FROM accounts WHERE session_token_hash = ? LIMIT 1'
  ).bind(await sha256(token)).first();
  if (!account || !account.session_expires_at || Number(account.session_expires_at) <= Date.now()) return null;
  return account;
}
function norm(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }

export async function onRequestGet({ request, env }) {
  try {
    const account = await currentAccount(request, env);
    if (!account) return json({ ok: false, error: 'unauthorized' }, 401);

    const url = new URL(request.url);
    const retailer = norm(url.searchParams.get('retailer') || '');
    const state = String(url.searchParams.get('state') || '').trim().toUpperCase();
    const search = String(url.searchParams.get('search') || '').trim().slice(0, 120);
    const limit = Math.min(100, Math.max(10, Number(url.searchParams.get('limit') || 60)));
    const pattern = '%' + search.replace(/[\\%_]/g, '\\$&') + '%';

    // Current alerts age out after 24 hours. A non-empty search queries the
    // saved report history so older sightings remain discoverable.
    const result = await env.DB.prepare(`
      SELECT id, store, location, product, quantity, price, photo_url, notes,
             price_type, product_located, seen_at, still_there, state, store_town,
             store_address, product_name, quantity_text, shelf_price, msrp, report_type, created_at
      FROM reports
      WHERE COALESCE(report_type, 'stock') != 'line'
        AND LOWER(TRIM(COALESCE(still_there, ''))) IN ('yes', 'true', 'in stock')
        AND (
          (? = '' AND datetime(created_at) >= datetime('now', '-24 hours'))
          OR
          (? != '' AND (
            COALESCE(store, '') LIKE ? ESCAPE '\\'
            OR COALESCE(location, '') LIKE ? ESCAPE '\\'
            OR COALESCE(product_name, '') LIKE ? ESCAPE '\\'
            OR COALESCE(product, '') LIKE ? ESCAPE '\\'
            OR COALESCE(notes, '') LIKE ? ESCAPE '\\'
            OR COALESCE(state, '') LIKE ? ESCAPE '\\'
            OR COALESCE(store_town, '') LIKE ? ESCAPE '\\'
            OR COALESCE(store_address, '') LIKE ? ESCAPE '\\'
          ))
        )
      ORDER BY datetime(created_at) DESC
      LIMIT 1000
    `).bind(search, search, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern).all();

    const reports = (result.results || []).filter(row => {
      const rowRetailer = norm(row.store);
      return (!retailer || rowRetailer.includes(retailer)) &&
        (!state || String(row.state || '').toUpperCase() === state);
    }).slice(0, limit).map(row => ({
      id: row.id,
      retailer: row.store || 'Store',
      location: row.location || [row.store_town, row.store_address].filter(Boolean).join(' — ') || 'Location not provided',
      state: row.state || '',
      product: row.product_name || row.product || 'Pokémon product',
      quantity: row.quantity_text || (row.quantity != null ? String(row.quantity) : ''),
      price: row.shelf_price != null ? row.shelf_price : row.price,
      priceType: row.price_type || 'Shelf price',
      productLocated: row.product_located || '',
      seenAt: row.seen_at || '',
      notes: row.notes || '',
      photos: String(row.photo_url || '').split(',').map(v => v.trim()).filter(Boolean),
      createdAt: row.created_at || ''
    }));
    return json({ ok: true, reports, count: reports.length, mode: search ? 'search' : 'live', refreshedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Live stock feed read failed:', error);
    return json({ ok: false, error: 'stock_feed_failed' }, 500);
  }
}
