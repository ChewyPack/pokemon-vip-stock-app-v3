const COOKIE = 'collector_session';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
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
export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  const account = await currentAccount(request, env);
  if (!account) return json({ ok: false, error: 'login_required' }, 401);
  try {
    const profile = await env.DB.prepare(
      'SELECT location_zip, location_enabled, search_radius_miles FROM collector_profiles WHERE account_id = ? LIMIT 1'
    ).bind(account.id).first();
    return json({
      ok: true,
      location_zip: profile?.location_zip || '',
      location_enabled: Number(profile?.location_enabled || 0) === 1,
      search_radius_miles: [10, 25, 50, 100].includes(Number(profile?.search_radius_miles))
        ? Number(profile.search_radius_miles) : 25
    });
  } catch (error) {
    console.error('Collector location read failed:', error);
    return json({ ok: false, error: 'wishlist_trades_migration_required' }, 500);
  }
}
export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  const account = await currentAccount(request, env);
  if (!account) return json({ ok: false, error: 'login_required' }, 401);
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'bad_request' }, 400); }
  const enabled = data.location_enabled === true;
  const zip = typeof data.location_zip === 'string' ? data.location_zip.trim() : '';
  const radius = Number(data.search_radius_miles || 25);
  if (![10, 25, 50, 100].includes(radius)) return json({ ok: false, error: 'invalid_radius' }, 400);
  if (enabled && !/^\d{5}$/.test(zip)) return json({ ok: false, error: 'valid_us_zip_required' }, 400);
  let lat = null, lng = null;
  if (enabled) {
    try {
      const response = await fetch('https://api.zippopotam.us/us/' + zip, {
        headers: { accept: 'application/json' }
      });
      if (!response.ok) return json({ ok: false, error: 'zip_not_found' }, 400);
      const result = await response.json();
      const place = result.places?.[0];
      lat = Number(place?.latitude);
      lng = Number(place?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return json({ ok: false, error: 'zip_lookup_failed' }, 502);
    } catch (error) {
      console.error('ZIP lookup failed:', error);
      return json({ ok: false, error: 'zip_lookup_unavailable' }, 502);
    }
  }
  try {
    const result = await env.DB.prepare(
      'UPDATE collector_profiles SET location_zip = ?, location_lat = ?, location_lng = ?, location_enabled = ?, search_radius_miles = ?, updated_at = CURRENT_TIMESTAMP WHERE account_id = ?'
    ).bind(enabled ? zip : '', lat, lng, enabled ? 1 : 0, radius, account.id).run();
    if (!result.meta?.changes) return json({ ok: false, error: 'collector_profile_missing' }, 409);
    return json({ ok: true, location_enabled: enabled, search_radius_miles: radius });
  } catch (error) {
    console.error('Collector location save failed:', error);
    return json({ ok: false, error: 'wishlist_trades_migration_required' }, 500);
  }
}
export async function onRequest() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
