const COOKIE = 'collector_session';

function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256(value) {
  return base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

function apiDenied(status, error, message) {
  return new Response(JSON.stringify({ ok: false, error, message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function lockPage() {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#07142e">
<title>Membership Required | PokePrizePool</title>
<link rel="stylesheet" href="/css/styles.css">
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
<body>
<main>
<div class="eyebrow">PokePrizePool Membership</div>
<h1>This feature is for paid members.</h1>
<p>You need an active paid PokePrizePool membership to access Live Stock Alerts and Market Intelligence.</p>
<p>Sign in to your existing account to check your membership. If you already pay for a membership and believe this is a mistake, please contact PokePrizePool support before purchasing another plan.</p>
<div class="actions"><a href="/account.html">Sign in / View account</a><a class="secondary" href="/">Return to PokePrizePool</a></div>
</main>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export async function onRequest({ request, env, next }) {
  const pathname = new URL(request.url).pathname;
  const isAlertsApi = pathname === '/api/alerts';
  if (pathname === '/alerts.html') return next(); // Free accounts may view delayed report history.
  if (isAlertsApi) return next(); // The API applies paid-live vs. delayed-history access itself.
  if (pathname !== '/alerts.html' && pathname !== '/market-intelligence.html' && !isAlertsApi) {
    return next();
  }

  try {
    if (!env.DB) return isAlertsApi ? apiDenied(503, 'access_check_unavailable', 'Membership could not be verified. Please try again shortly.') : lockPage();
    const cookieHeader = request.headers.get('Cookie') || '';
    const token = cookieHeader.split(';').map(part => part.trim())
      .find(part => part.startsWith(COOKIE + '='));
    if (!token) return isAlertsApi ? apiDenied(401, 'unauthorized', 'Please sign in to your PokePrizePool account.') : lockPage();

    const sessionHash = await sha256(token.slice(COOKIE.length + 1));
    const account = await env.DB.prepare(
      `SELECT id, session_expires_at, is_admin, membership_tier,
              membership_entitlement_tier, membership_status
       FROM accounts WHERE session_token_hash = ? LIMIT 1`
    ).bind(sessionHash).first();

    if (!account || !account.session_expires_at || Number(account.session_expires_at) <= Date.now()) {
      return isAlertsApi ? apiDenied(401, 'unauthorized', 'Please sign in to your PokePrizePool account.') : lockPage();
    }

    const tier = String(account.membership_entitlement_tier || account.membership_tier || 'free').trim().toLowerCase();
    const status = String(account.membership_status || '').trim().toLowerCase();
    const paid = Number(account.is_admin || 0) === 1 ||
      (status === 'active' && tier !== '' && tier !== 'free' && tier !== 'none');

    return paid ? next() : (isAlertsApi ? apiDenied(403, 'membership_required', 'An active paid membership is required to access Live Stock Alerts.') : lockPage());
  } catch (error) {
    console.error('Paid page access check failed:', error);
    return isAlertsApi ? apiDenied(503, 'access_check_failed', 'Membership could not be verified. Please try again shortly.') : lockPage();
  }
}
