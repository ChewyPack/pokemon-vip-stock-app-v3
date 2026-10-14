const SESSION_DAYS = 14;
const PBKDF2_ITERATIONS = 310000;
const COOKIE = 'collector_session';

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });
}
function b64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, key, 256);
  return b64(bits);
}
async function sha256(value) {
  return b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
function cookie(token, expiresAt) {
  return [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', `Expires=${new Date(expiresAt).toUTCString()}`].join('; ');
}
export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok:false, error:'database_not_configured' }, 500);
  let data;
  try { data = await request.json(); } catch { return json({ ok:false, error:'bad_request' }, 400); }
  const displayName = typeof data.display_name === 'string' ? data.display_name.trim() : '';
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  const password = typeof data.password === 'string' ? data.password : '';
  if (displayName.length < 2 || displayName.length > 60) return json({ ok:false, error:'invalid_name' }, 400);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok:false, error:'invalid_email' }, 400);
  if (password.length < 12 || password.length > 128) return json({ ok:false, error:'password_requirements' }, 400);
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await passwordHash(password, salt);
    const token = b64(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash = await sha256(token);
    const expiresAt = Date.now() + SESSION_DAYS * 86400000;
    const result = await env.DB.prepare(
      'INSERT INTO accounts (display_name,email,password_salt,password_hash,session_token_hash,session_expires_at) VALUES (?,?,?,?,?,?)'
    ).bind(displayName,email,b64(salt),hash,tokenHash,expiresAt).run();
    if (!result.meta || result.meta.changes !== 1) throw new Error('Account insert did not complete');
    return json({ ok:true, account:{ display_name:displayName, email }, note:'Account created. VIP membership remains separate and is not granted by registration.' }, 201, { 'Set-Cookie':cookie(token,expiresAt) });
  } catch (error) {
    if (String(error && error.message || '').toLowerCase().includes('unique')) return json({ ok:false, error:'email_already_registered' }, 409);
    console.error('Account registration failed:', error);
    return json({ ok:false, error:'registration_failed' }, 500);
  }
}
export async function onRequest() { return json({ok:false,error:'method_not_allowed'},405); }
