const PBKDF2_ITERATIONS = 100000;
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }); }
function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
async function sha256(value) { return b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); }
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, key, 256));
}
export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  let data; try { data = await request.json(); } catch { return json({ ok: false, error: 'bad_request' }, 400); }
  const token = typeof data.token === 'string' ? data.token : '';
  const password = typeof data.password === 'string' ? data.password : '';
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return json({ ok: false, error: 'invalid_or_expired_reset_link' }, 400);
  if (password.length < 10 || password.length > 128) return json({ ok: false, error: 'password_requirements' }, 400);
  try {
    const tokenHash = await sha256(token);
    const reset = await env.DB.prepare('SELECT account_id FROM account_password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? LIMIT 1').bind(tokenHash, Date.now()).first();
    if (!reset) return json({ ok: false, error: 'invalid_or_expired_reset_link' }, 400);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await passwordHash(password, salt);
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('UPDATE accounts SET password_salt = ?, password_hash = ?, session_token_hash = NULL, session_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(b64(salt), hash, reset.account_id),
      env.DB.prepare('UPDATE account_password_resets SET used_at = ? WHERE account_id = ? AND used_at IS NULL').bind(now, reset.account_id)
    ]);
    return json({ ok: true });
  } catch (error) {
    console.error('Password reset completion failed:', error);
    return json({ ok: false, error: 'password_reset_failed' }, 500);
  }
}
export async function onRequest() { return json({ ok: false, error: 'method_not_allowed' }, 405); }
