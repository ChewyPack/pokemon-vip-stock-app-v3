import { SECURING_PRODUCT_HTML_BASE64 } from '../_shared/securing-product-content.js';

const COOKIE = 'collector_session';

function htmlResponse(markup, status = 200) {
  return new Response(markup, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store, max-age=0',
      'pragma': 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin'
    }
  });
}

function getCookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const item = part.trim();
    if (item.startsWith(name + '=')) return item.slice(name.length + 1);
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
  const token = getCookie(request, COOKIE);
  if (!token) return null;
  const account = await env.DB.prepare(
    'SELECT id, is_admin, session_expires_at, membership_status, membership_tier, membership_entitlement_tier FROM accounts WHERE session_token_hash = ? LIMIT 1'
  ).bind(await sha256(token)).first();
  if (!account || !account.session_expires_at || Number(account.session_expires_at) <= Date.now()) return null;
  return account;
}

function isPaidMember(account) {
  if (!account) return false;
  if (Number(account.is_admin || 0) === 1) return true;
  const status = String(account.membership_status || '').toLowerCase().trim();
  if (!['active', 'trialing'].includes(status)) return false;
  const tiers = [account.membership_entitlement_tier, account.membership_tier]
    .filter(Boolean)
    .map(value => String(value).toLowerCase().trim()
      .replace(/\+/g, '_plus')
      .replace(/[\s-]+/g, '_'));
  return tiers.some(tier => [
    'collector_plus', 'vendor', 'vendor_plus',
    'organizer', 'organizer_plus',
    'event_organizer', 'event_organizer_plus',
    'vip', 'lifetime', 'lifetime_vip'
  ].includes(tier));
}

function gatePage({ signedIn, error = '' } = {}) {
  const heading = signedIn ? 'Upgrade to Unlock This Guide' : 'A Member-Only Field Guide';
  const message = signedIn
    ? 'Securing Product is reserved for active paid PokePrizePool members. Upgrade your membership to unlock the full guide, route planner, budget tools, and drop-day checklist.'
    : 'Sign in with an active paid PokePrizePool membership to access the Securing Product field guide, route planner, budget tools, and drop-day checklist.';
  const errorMessage = error
    ? '<p style="color:#ffb4bd;margin:0 0 14px">We could not verify access right now. Please refresh this page and try again.</p>'
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading} | PokePrizePool</title>
<link rel="stylesheet" href="/css/site-nav.css">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Barlow:wght@400;500;600&display=swap">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#07142e;color:#e8ecf5;font:16px/1.6 Barlow,system-ui,sans-serif}.gate-wrap{width:min(760px,calc(100% - 32px));margin:64px auto}.gate-card{padding:clamp(24px,5vw,48px);border:1px solid #293852;border-radius:20px;background:linear-gradient(145deg,#101b31,#10141f);box-shadow:0 20px 60px #0004}.eyebrow{color:#ffcb05;font-weight:700;letter-spacing:.16em;text-transform:uppercase;font-size:.78rem}h1{margin:10px 0 16px;font:800 clamp(2.3rem,7vw,4.2rem)/1.02 'Barlow Condensed',Impact,sans-serif;text-transform:uppercase;color:#fff}p{color:#b8c5dc}.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:24px}.btn{display:inline-block;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700;background:#3d8bff;color:#fff;border:1px solid #3d8bff}.btn.secondary{background:#151b2a;border-color:#33435f;color:#e8ecf5}.fine{font-size:.9rem}
</style>
</head>
<body>
<div id="site-navigation"></div>
<main class="gate-wrap"><section class="gate-card">
<p class="eyebrow">PokePrizePool Field Guide</p><h1>${heading}</h1>
${errorMessage}<p>${message}</p>
<div class="actions">
<a class="btn" href="/account.html?next=%2Fresources%2Fsecuring-product">${signedIn ? 'View Membership Options' : 'Sign In / Create Account'}</a>
<a class="btn secondary" href="/account.html">${signedIn ? 'Manage Membership' : 'Explore Memberships'}</a>
<a class="btn secondary" href="/">Back to Home</a>
</div>
<p class="fine">You’ll return to Securing Product after signing in. Your access is checked securely against your account membership.</p>
</section></main>
<script src="/js/ui/site-nav.js"></script>
</body>
</html>`;
}

function decodeGuide() {
  const binary = atob(SECURING_PRODUCT_HTML_BASE64);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return htmlResponse(gatePage({ error: 'database_not_configured' }), 503);
  try {
    const account = await currentAccount(request, env);
    if (!account) return htmlResponse(gatePage({ signedIn: false }), 401);
    if (!isPaidMember(account)) return htmlResponse(gatePage({ signedIn: true }), 403);
    return htmlResponse(decodeGuide(), 200);
  } catch (error) {
    console.error('Securing Product access check failed:', error);
    return htmlResponse(gatePage({ error: 'membership_check_failed' }), 503);
  }
}

export async function onRequest() {
  return htmlResponse(gatePage({ signedIn: false }), 405);
}
