const TOKEN_MINUTES = 30;
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }); }
function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
async function sha256(value) { return b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); }
export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  if (!env.RESEND_API_KEY || !env.PASSWORD_RESET_FROM) return json({ ok: false, error: 'password_reset_email_not_configured' }, 503);
  let data; try { data = await request.json(); } catch { return json({ ok: false, error: 'bad_request' }, 400); }
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'invalid_email' }, 400);
  try {
    const account = await env.DB.prepare('SELECT id, display_name, email FROM accounts WHERE email = ? COLLATE NOCASE LIMIT 1').bind(email).first();
    if (account) {
      const recent = await env.DB.prepare("SELECT COUNT(*) AS total FROM account_password_resets WHERE account_id = ? AND created_at >= datetime('now', '-1 hour')").bind(account.id).first();
      if (Number(recent?.total || 0) < 3) {
        const token = b64(crypto.getRandomValues(new Uint8Array(32)));
        const tokenHash = await sha256(token);
        const expiresAt = Date.now() + TOKEN_MINUTES * 60 * 1000;
        await env.DB.prepare('UPDATE account_password_resets SET used_at = ? WHERE account_id = ? AND used_at IS NULL').bind(Date.now(), account.id).run();
        await env.DB.prepare('INSERT INTO account_password_resets (token_hash, account_id, expires_at) VALUES (?, ?, ?)').bind(tokenHash, account.id, expiresAt).run();
        const requestUrl = new URL(request.url);
        const baseUrl = env.PASSWORD_RESET_BASE_URL || requestUrl.origin;
        const resetUrl = new URL('/account.html?reset=' + encodeURIComponent(token), baseUrl).toString();
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: env.PASSWORD_RESET_FROM,
            to: [account.email],
            subject: 'Reset your PokePrizePool password',
            html: '<p>Hi ' + String(account.display_name || 'Collector').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])) + ',</p><p>We received a request to reset your PokePrizePool password.</p><p><a href="' + resetUrl + '">Reset your password</a></p><p>This link expires in 30 minutes and can only be used once. If you did not request this, you can ignore this email.</p>',
            text: 'Reset your PokePrizePool password: ' + resetUrl + '\nThis link expires in 30 minutes and can only be used once. If you did not request this, ignore this email.'
          })
        });
        if (!response.ok) {
          console.error('Password reset email provider failed:', response.status);
          await env.DB.prepare('DELETE FROM account_password_resets WHERE token_hash = ?').bind(tokenHash).run();
          return json({ ok: false, error: 'password_reset_email_failed' }, 502);
        }
      }
    }
    return json({ ok: true, message: 'If an account exists for that email, a password reset link will be sent shortly.' });
  } catch (error) {
    console.error('Password reset request failed:', error);
    return json({ ok: false, error: 'password_reset_request_failed' }, 500);
  }
}
export async function onRequest() { return json({ ok: false, error: 'method_not_allowed' }, 405); }
