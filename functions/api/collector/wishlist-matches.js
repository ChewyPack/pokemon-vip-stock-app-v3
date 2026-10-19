const COOKIE = 'collector_session';
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
function cookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const value = part.trim();
    if (value.startsWith(name + '=')) return value.slice(name.length + 1);
  }
  return '';
}
function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(value) {
  return base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
async function currentAccount(request, env) {
  const token = cookie(request, COOKIE);
  if (!token) return null;
  const account = await env.DB.prepare(
    'SELECT id, session_expires_at FROM accounts WHERE session_token_hash = ? LIMIT 1'
  ).bind(await sha256(token)).first();
  return account && account.session_expires_at && Number(account.session_expires_at) > Date.now()
    ? account : null;
}
function distanceMiles(aLat, aLng, bLat, bLng) {
  const rad = value => value * Math.PI / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}
export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  const account = await currentAccount(request, env);
  if (!account) return json({ ok: false, error: 'login_required' }, 401);
  try {
    const viewer = await env.DB.prepare(
      'SELECT location_lat, location_lng, location_enabled, search_radius_miles FROM collector_profiles WHERE account_id = ? LIMIT 1'
    ).bind(account.id).first();
    const radius = [10, 25, 50, 100].includes(Number(viewer?.search_radius_miles))
      ? Number(viewer.search_radius_miles) : 25;
    const wants = await env.DB.prepare(`
      SELECT i.id, i.product_type, i.product_name, i.set_name, i.card_number, i.image_url, c.tcgcsv_product_id
      FROM collector_items i
      LEFT JOIN collector_item_catalog c ON c.item_id = i.id
      WHERE i.account_id = ? AND i.list_type = 'wishlist'
      ORDER BY created_at DESC LIMIT 500
    `).bind(account.id).all();
    const wishlist = wants.results || [];
    if (!wishlist.length) return json({ ok: true, radius_miles: radius, location_enabled: Number(viewer?.location_enabled || 0) === 1, matches: [] });

    const owned = await env.DB.prepare(`
      SELECT i.id AS item_id, i.account_id, i.product_type, i.product_name, i.set_name,
             i.card_number, i.condition, i.quantity, i.image_url, c.tcgcsv_product_id,
             p.username, p.avatar_url, p.location_lat, p.location_lng, p.location_enabled
      FROM collector_items i
      LEFT JOIN collector_item_catalog c ON c.item_id = i.id
      JOIN collector_profiles p ON p.account_id = i.account_id
      WHERE i.list_type = 'collection'
        AND i.account_id <> ?
        AND p.is_public = 1
        AND EXISTS (
          SELECT 1 FROM collector_blocks b
          WHERE (b.blocker_account_id = ? AND b.blocked_account_id = i.account_id)
             OR (b.blocker_account_id = i.account_id AND b.blocked_account_id = ?)
        ) = 0
      LIMIT 5000
    `).bind(account.id, account.id, account.id).all();
    const matches = wishlist.map(want => {
      const same = (owned.results || []).filter(item =>
        String(item.product_type).toLowerCase() === String(want.product_type).toLowerCase() &&
        ((want.tcgcsv_product_id != null && item.tcgcsv_product_id != null && Number(item.tcgcsv_product_id) === Number(want.tcgcsv_product_id)) ||
         ((want.tcgcsv_product_id == null || item.tcgcsv_product_id == null) && String(item.product_name).trim().toLowerCase() === String(want.product_name).trim().toLowerCase() &&
        String(item.set_name || '').trim().toLowerCase() === String(want.set_name || '').trim().toLowerCase() &&
        String(item.card_number || '').trim().toLowerCase() === String(want.card_number || '').trim().toLowerCase()))
      ).map(item => {
        const hasDistance = Number(viewer?.location_enabled) === 1 &&
          Number(item.location_enabled) === 1 &&
          Number.isFinite(Number(viewer?.location_lat)) && Number.isFinite(Number(viewer?.location_lng)) &&
          Number.isFinite(Number(item.location_lat)) && Number.isFinite(Number(item.location_lng));
        const miles = hasDistance ? distanceMiles(
          Number(viewer.location_lat), Number(viewer.location_lng),
          Number(item.location_lat), Number(item.location_lng)
        ) : null;
        return {
          username: item.username,
          avatar_url: item.avatar_url || '',
          quantity: Number(item.quantity || 1),
          item_id: Number(item.item_id),
          distance_miles: miles === null ? null : Math.round(miles),
          within_radius: miles !== null && miles <= radius
        };
      });
      const locationEnabled = Number(viewer?.location_enabled || 0) === 1;
      const visible = locationEnabled ? same.filter(item => item.within_radius) : same;
      return {
        wishlist_item: {
          id: Number(want.id), product_type: want.product_type, tcgcsv_product_id: want.tcgcsv_product_id || null,
          product_name: want.product_name, set_name: want.set_name,
          card_number: want.card_number, image_url: want.image_url || ''
        },
        collectors_count: visible.length,
        nearby_count: visible.filter(item => item.within_radius).length,
        distance_available: Number(viewer?.location_enabled || 0) === 1,
        collectors: visible
      };
    }).filter(match => match.collectors_count > 0);
    return json({
      ok: true, radius_miles: radius,
      location_enabled: Number(viewer?.location_enabled || 0) === 1,
      matches
    });
  } catch (error) {
    console.error('Wishlist matching failed:', error);
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('no such table') || message.includes('no such column')) {
      return json({ ok: false, error: 'wishlist_trades_migration_required' }, 500);
    }
    return json({ ok: false, error: 'wishlist_matching_failed' }, 500);
  }
}
export async function onRequest() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
