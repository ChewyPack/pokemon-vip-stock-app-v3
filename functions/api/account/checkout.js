/*
 * POST /api/account/checkout
 * Staging-only Stripe Test Mode checkout for website account memberships.
 * Requires STRIPE_TEST_SECRET_KEY (must start with sk_test_).
 * Does not change the legacy /api/checkout endpoint or VIP webhook.
 */
const COOKIE = 'collector_session';
const PRICES = {
  collector_plus: {
    monthly: 'price_1UQVNSGXWs1THDBR6RhAZ3dI',
    yearly: 'price_1UQVNSGXWs1THDBRvoZUm24d'
  },
  vendor: {
    monthly: 'price_1UQVOUGXWs1THDBRYzlRnDDy',
    yearly: 'price_1UQVOUGXWs1THDBRsL4w405C'
  },
  organizer: {
    monthly: 'price_1UQVQLGXWs1THDBR39ZABaOC',
    yearly: 'price_1UQVQLGXWs1THDBRe7oCo2FN'
  }
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
function getCookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const p = part.trim();
    if (p.startsWith(name + '=')) return p.slice(name.length + 1);
  }
  return '';
}
function b64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(value) {
  return b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  if (typeof env.STRIPE_TEST_SECRET_KEY !== 'string' || !env.STRIPE_TEST_SECRET_KEY.startsWith('sk_test_')) {
    return json({ ok: false, error: 'stripe_test_key_not_configured' }, 503);
  }
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'bad_request' }, 400); }
  const tier = typeof data.tier === 'string' ? data.tier : '';
  const interval = typeof data.interval === 'string' ? data.interval : '';
  if (!Object.prototype.hasOwnProperty.call(PRICES, tier) || !['monthly', 'yearly'].includes(interval)) {
    return json({ ok: false, error: 'invalid_plan' }, 400);
  }
  const token = getCookie(request, COOKIE);
  if (!token) return json({ ok: false, error: 'login_required' }, 401);
  try {
    const account = await env.DB.prepare(
      'SELECT id, display_name, email, account_type, session_expires_at, membership_status FROM accounts WHERE session_token_hash = ? LIMIT 1'
    ).bind(await sha256(token)).first();
    if (!account || !account.session_expires_at || Number(account.session_expires_at) <= Date.now()) {
      return json({ ok: false, error: 'login_required' }, 401);
    }
    if (account.membership_status === 'active') {
      return json({ ok: false, error: 'membership_already_active' }, 409);
    }
    if (tier === 'vendor' && account.account_type !== 'vendor') return json({ ok: false, error: 'choose_vendor_account_type' }, 400);
    if (tier === 'organizer' && account.account_type !== 'organizer') return json({ ok: false, error: 'choose_organizer_account_type' }, 400);
    if (tier === 'collector_plus' && !['free', 'collector'].includes(account.account_type)) return json({ ok: false, error: 'choose_collector_account_type' }, 400);
    const priceId = PRICES[tier][interval];
    const origin = new URL(request.url).origin;
    const params = new URLSearchParams();
    params.set('mode', 'subscription');
    params.set('line_items[0][price]', priceId);
    params.set('line_items[0][quantity]', '1');
    params.set('client_reference_id', String(account.id));
    params.set('customer_email', account.email);
    params.set('success_url', origin + '/account.html?checkout=success&session_id={CHECKOUT_SESSION_ID}');
    params.set('cancel_url', origin + '/account.html?checkout=cancelled');
    params.set('billing_address_collection', 'auto');
    params.set('allow_promotion_codes', 'true');
    params.set('metadata[account_id]', String(account.id));
    params.set('metadata[membership_tier]', tier);
    params.set('metadata[billing_interval]', interval);
    params.set('subscription_data[metadata][account_id]', String(account.id));
    params.set('subscription_data[metadata][membership_tier]', tier);
    params.set('subscription_data[metadata][billing_interval]', interval);
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.STRIPE_TEST_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    const result = await response.json();
    if (!response.ok || !result.url) {
      console.error('Staging Stripe checkout creation failed:', response.status, result.error?.type || 'unknown');
      return json({ ok: false, error: 'stripe_checkout_failed' }, 502);
    }
    return json({ ok: true, url: result.url });
  } catch (error) {
    console.error('Staging account checkout failed:', error);
    return json({ ok: false, error: 'checkout_failed' }, 500);
  }
}
export async function onRequest() { return json({ ok: false, error: 'method_not_allowed' }, 405); }
