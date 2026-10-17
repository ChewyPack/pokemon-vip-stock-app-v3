const SESSION_DAYS = 14;
const PBKDF2_ITERATIONS = 100000;
const COOKIE = 'collector_session';
const ACCOUNT_TYPES = new Set(['free', 'collector', 'vendor', 'organizer']);
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}
function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, key, 256));
}
async function sha256(value) { return b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); }
function cookie(token, expiresAt) { return [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', `Expires=${new Date(expiresAt).toUTCString()}`].join('; '); }
export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok:false, error:'database_not_configured' }, 500);
  let data; try { data = await request.json(); } catch { return json({ ok:false, error:'bad_request' }, 400); }
  const displayName = typeof data.username === 'string' ? data.username.trim() : '';
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  const password = typeof data.password === 'string' ? data.password : '';
  const accountType = typeof data.account_type === 'string' ? data.account_type : '';
  const username = typeof data.username === 'string' ? data.username.trim() : '';
  const bio = typeof data.bio === 'string' ? data.bio.trim() : '';
  const avatarUrl = typeof data.avatar_url === 'string' ? data.avatar_url.trim() : '';
  const locationEnabled = data.location_enabled === true;
  const locationZip = typeof data.location_zip === 'string' ? data.location_zip.trim() : '';
  const searchRadius = Number(data.search_radius_miles || 25);
  if (![10,25,50,100].includes(searchRadius)) return json({ok:false,error:'invalid_radius'},400);
  let locationLat = null, locationLng = null;
  if (locationEnabled) {
    if (!/^\d{5}$/.test(locationZip)) return json({ok:false,error:'valid_us_zip_required'},400);
    try {
      const zipResponse = await fetch('https://api.zippopotam.us/us/' + locationZip, {headers:{accept:'application/json'}});
      if (!zipResponse.ok) return json({ok:false,error:'zip_not_found'},400);
      const zipData = await zipResponse.json(), place = zipData.places?.[0];
      locationLat = Number(place?.latitude); locationLng = Number(place?.longitude);
      if (!Number.isFinite(locationLat) || !Number.isFinite(locationLng)) return json({ok:false,error:'zip_lookup_failed'},502);
    } catch (error) { console.error('Signup ZIP lookup failed:', error); return json({ok:false,error:'zip_lookup_unavailable'},502); }
  }
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return json({ ok:false, error:'invalid_username' }, 400);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok:false, error:'invalid_email' }, 400);
  if (!ACCOUNT_TYPES.has(accountType)) return json({ ok:false, error:'invalid_account_type' }, 400);
  if (password.length < 10 || password.length > 128) return json({ ok:false, error:'password_requirements' }, 400);
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await passwordHash(password, salt);
    const token = b64(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash = await sha256(token);
    const expiresAt = Date.now() + SESSION_DAYS * 86400000;
    const results = await env.DB.batch([
      env.DB.prepare('INSERT INTO accounts (display_name,email,account_type,password_salt,password_hash,session_token_hash,session_expires_at) VALUES (?,?,?,?,?,?,?)').bind(displayName,email,accountType,b64(salt),hash,tokenHash,expiresAt),
      env.DB.prepare('INSERT INTO collector_profiles (account_id,username,bio,avatar_url,is_public,location_zip,location_lat,location_lng,location_enabled,search_radius_miles) SELECT id,?,?,?,1,?,?,?,?,? FROM accounts WHERE email=? COLLATE NOCASE').bind(username,bio,avatarUrl,locationEnabled?locationZip:'',locationLat,locationLng,locationEnabled?1:0,searchRadius,email)
    ]);
    if (!results[0]?.meta || results[0].meta.changes !== 1 || !results[1]?.meta || results[1].meta.changes !== 1) throw new Error('Account and collector profile creation did not complete');
    return json({ ok:true, account:{ display_name:displayName, email, account_type:accountType, username }, note:'Account type does not grant VIP, vendor verification, or organizer privileges.' }, 201, { 'Set-Cookie':cookie(token,expiresAt) });
  } catch (error) {
    if (String(error && error.message || '').toLowerCase().includes('unique')) {
      const usernameExists = await env.DB.prepare('SELECT id FROM collector_profiles WHERE username=? COLLATE NOCASE LIMIT 1').bind(username).first().catch(()=>null);
      return json({ ok:false, error:usernameExists?'username_taken':'email_already_registered' }, 409);
    }
    console.error('Account registration failed:', error);
        return json({ ok:false, error:'registration_failed' }, 500);
  }
}
export async function onRequest() { return json({ok:false,error:'method_not_allowed'},405); }
