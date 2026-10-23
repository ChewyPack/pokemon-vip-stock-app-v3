const COOKIE = 'collector_session';

function jsonDenied(status, error, message) {
  return new Response(JSON.stringify({ ok: false, error, message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function lockedPage() {
  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#07142e">
<title>Membership Required | PokePrizePool</title>
<style>
body{margin:0;min-height:100vh;background:#07142e;color:#fff;font-family:Arial,sans-serif;display:grid;place-items:center;padding:24px;box-sizing:border-box}
main{max-width:620px;padding:clamp(24px,5vw,42px);border:1px solid #344565;border-radius:18px;background:#101b31;box-shadow:0 18px 55px #0005}
.eyebrow{color:#9ef2dc;font-weight:800;letter-spacing:.12em;text-transform:uppercase;font-size:.78rem}
h1{font-size:clamp(2rem,5vw,3rem);line-height:1.05;margin:12px 0}
p{color:#d1dbed;line-height:1.7}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:24px}
a{display:inline-block;padding:12px 16px;border-radius:9px;background:#a5f3e6;color:#061b22;text-decoration:none;font-weight:800}
a.secondary{background:#1b2b47;color:#fff;border:1px solid #40516e}
</style>
</head>
<body><main><div class="eyebrow">PokePrizePool Membership</div>
<h1>Market Intelligence is for paid members.</h1>
<p>You need an active paid PokePrizePool membership to access Market Intelligence.</p>
<p>Sign in to your existing account to check your membership. If you already pay and believe this is a mistake, contact support before purchasing another plan.</p>
<div class="actions"><a href="/account.html">Sign in / View account</a><a class="secondary" href="/">Return to PokePrizePool</a></div>
</main></body></html>`, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function getCookie(request) {
  const part = (request.headers.get('Cookie') || '').split(';')
    .map(value => value.trim()).find(value => value.startsWith(COOKIE + '='));
  return part ? part.slice(COOKIE.length + 1) : '';
}

function b64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256(value) {
  return b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

export async function onRequest({ request, env, next }) {
  try {
    if (!env.DB) return lockedPage();
    const token = getCookie(request);
    if (!token) return lockedPage();
    const hash = await sha256(token);
    const account = await env.DB.prepare(
      'SELECT session_expires_at, is_admin, membership_tier, membership_entitlement_tier, membership_status FROM accounts WHERE session_token_hash = ? LIMIT 1'
    ).bind(hash).first();

    if (!account || !account.session_expires_at || Number(account.session_expires_at) <= Date.now()) {
      return lockedPage();
    }
    const tier = String(account.membership_entitlement_tier || account.membership_tier || 'free').trim().toLowerCase();
    const status = String(account.membership_status || '').trim().toLowerCase();
    const paid = Number(account.is_admin || 0) === 1 ||
      (status === 'active' && tier !== '' && tier !== 'free' && tier !== 'none');
    return paid ? next() : lockedPage();
  } catch (error) {
    console.error('Market Intelligence access check failed:', error);
    return lockedPage();
  }
}
