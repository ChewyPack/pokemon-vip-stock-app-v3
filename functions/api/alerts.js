const COOKIE = 'collector_session';
const VIP_COOKIE = 'vip_session';

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
  // Preserve access for existing paid VIP members stored in the production users table.
  const vipToken = getCookie(request, VIP_COOKIE);
  if (vipToken) {
    const vipMember = await env.DB.prepare(
      "SELECT id, session_expires_at, membership_status, membership_type FROM users WHERE session_token_hash = ? AND membership_status = 'active' LIMIT 1"
    ).bind(await sha256(vipToken)).first();
    if (vipMember && vipMember.session_expires_at && Number(vipMember.session_expires_at) > Date.now()) {
      return {
        id: vipMember.id,
        session_expires_at: vipMember.session_expires_at,
        is_admin: 0,
        membership_tier: vipMember.membership_type || 'vip',
        membership_entitlement_tier: vipMember.membership_type || 'vip',
        membership_status: 'active',
        legacyVip: true
      };
    }
  }

  const token = getCookie(request, COOKIE);
  if (!token) return null;
  // The collector-account tables are not present in the legacy production schema.
  // Treat their absence as no collector account, not as a failure for VIP sessions.
  try {
    const account = await env.DB.prepare(
      'SELECT id, session_expires_at, is_admin, membership_tier, membership_entitlement_tier, membership_status FROM accounts WHERE session_token_hash = ? LIMIT 1'
    ).bind(await sha256(token)).first();
    if (!account || !account.session_expires_at || Number(account.session_expires_at) <= Date.now()) return null;
    return account;
  } catch (error) {
    console.warn('Collector account lookup unavailable in this database:', error);
    return null;
  }
}
function norm(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }

export async function onRequestGet({ request, env }) {
  try {
    const account = await currentAccount(request, env);
    if (!account) return json({ ok: false, error: 'unauthorized' }, 401);

    const tier = String(account.membership_entitlement_tier || account.membership_tier || 'free').trim().toLowerCase();
    const status = String(account.membership_status || '').trim().toLowerCase();
    const paid = account.legacyVip === true || Number(account.is_admin || 0) === 1 ||
      (status === 'active' && tier !== '' && tier !== 'free' && tier !== 'none');

    const url = new URL(request.url);
    const retailer = norm(url.searchParams.get('retailer') || '');
    const state = String(url.searchParams.get('state') || '').trim().toUpperCase();
    const search = String(url.searchParams.get('search') || '').trim().slice(0, 120);
    const limit = Math.min(100, Math.max(10, Number(url.searchParams.get('limit') || 60)));
    const pattern = '%' + search + '%';

    // Adapt to both the legacy production reports table and newer staging schema.
    const columns = await env.DB.prepare('PRAGMA table_info(reports)').all();
    const hasReportType = (columns.results || []).some(column => column.name === 'report_type');
    const reportTypeSelect = hasReportType ? ', report_type' : '';
    const reportTypeFilter = hasReportType ? "AND COALESCE(report_type, 'stock') != 'line'" : '';

    // Current alerts age out after 24 hours. A non-empty search queries saved report history.
    const result = await env.DB.prepare(`
      SELECT id, store, location, product, quantity, price, photo_url, notes,
             price_type, product_located, seen_at, still_there, state, store_town,
             store_address, product_name, quantity_text, shelf_price, msrp${reportTypeSelect}, created_at
      FROM reports
      WHERE 1 = 1
        ${reportTypeFilter}
        AND (? = 1 OR datetime(created_at) <= datetime('now', '-1 hour'))
        AND LOWER(TRIM(COALESCE(still_there, ''))) IN ('yes', 'true', 'in stock')
        AND (
          (? = '' AND datetime(created_at) >= datetime('now', '-24 hours'))
          OR
          (? != '' AND (
            COALESCE(store, '') LIKE ?
            OR COALESCE(location, '') LIKE ?
            OR COALESCE(product_name, '') LIKE ?
            OR COALESCE(product, '') LIKE ?
            OR COALESCE(notes, '') LIKE ?
            OR COALESCE(state, '') LIKE ?
            OR COALESCE(store_town, '') LIKE ?
            OR COALESCE(store_address, '') LIKE ?
          ))
        )
      ORDER BY datetime(created_at) DESC
      LIMIT 1000
    `).bind(paid ? 1 : 0, search, search, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern).all();

    const reports = (result.results || []).filter(row => {
      const rowRetailer = norm(row.store);
      return (!retailer || rowRetailer.includes(retailer)) &&
        (!state || String(row.state || '').toUpperCase() === state);
    }).slice(0, limit).map(row => ({
      id: row.id,
      retailer: row.store || 'Store',
      location: row.location || [row.store_town, row.store_address].filter(Boolean).join(' — ') || 'Location not provided',
      state: row.state || '',
      productType: String(row.product || '').includes(' — ')
        ? String(row.product).split(' — ')[0].trim()
        : '',
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
