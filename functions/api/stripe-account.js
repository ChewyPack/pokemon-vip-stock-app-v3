/*
 * POST /api/stripe-account
 * Separate Test Mode webhook for website account memberships.
 * Uses STRIPE_ACCOUNT_TEST_WEBHOOK_SECRET + STRIPE_TEST_SECRET_KEY only.
 * Intentionally does not modify the legacy VIP users/Discord webhook.
 */
const PRICE_TIERS = {
  'price_1UQVNSGXWs1THDBR6RhAZ3dI': 'collector_plus',
  'price_1UQVNSGXWs1THDBRvoZUm24d': 'collector_plus',
  'price_1UQVOUGXWs1THDBRYzlRnDDy': 'vendor',
  'price_1UQVOUGXWs1THDBRsL4w405C': 'vendor',
  'price_1UQVQLGXWs1THDBR39ZABaOC': 'organizer',
  'price_1UQVQLGXWs1THDBRe7oCo2FN': 'organizer'
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
async function verifySignature(payload, header, secret) {
  if (!secret || !header) return null;
  const parts = header.split(',');
  const timestamp = parts.find(p => p.startsWith('t='))?.slice(2);
  const signatures = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  if (!timestamp || !/^\d+$/.test(timestamp) || !signatures.length) return null;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return null;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(timestamp + '.' + payload));
  const expected = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  if (!signatures.some(s => s.length === expected.length && /^[a-f0-9]+$/i.test(s) && s.toLowerCase() === expected)) return null;
  try { return JSON.parse(payload); } catch { return null; }
}
function stripeId(value) { return typeof value === 'string' ? value : value?.id || ''; }
function allowedTier(subscription) {
  const items = subscription?.items?.data || [];
  const tiers = [...new Set(items.map(item => PRICE_TIERS[item.price?.id]).filter(Boolean))];
  const allAllowed = items.length > 0 && items.every(item => PRICE_TIERS[item.price?.id]);
  if (!allAllowed || tiers.length !== 1) return '';
  return tiers[0];
}
async function fetchSubscription(id, env) {
  if (!id || !env.STRIPE_TEST_SECRET_KEY?.startsWith('sk_test_')) return null;
  const response = await fetch('https://api.stripe.com/v1/subscriptions/' + encodeURIComponent(id), {
    headers: { Authorization: 'Bearer ' + env.STRIPE_TEST_SECRET_KEY }
  });
  if (!response.ok) {
    console.error('Could not verify Test Mode subscription:', response.status);
    return null;
  }
  return response.json();
}
function subscriptionPeriodEnd(subscription) {
  // Newer Stripe API versions expose billing-period dates on subscription items.
  // Keep the subscription-level field as a fallback for older API responses.
  const topLevel = Number(subscription?.current_period_end || 0);
  if (topLevel > 0) return topLevel;
  const itemEnds = (subscription?.items?.data || [])
    .map(item => Number(item?.current_period_end || 0))
    .filter(value => Number.isFinite(value) && value > 0);
  return itemEnds.length ? Math.max(...itemEnds) : null;
}
async function saveSubscription(subscription, env, forcedStatus) {
  const accountId = Number(subscription?.metadata?.account_id || 0);
  const tier = allowedTier(subscription);
  if (!Number.isSafeInteger(accountId) || accountId < 1 || !tier) {
    console.error('Ignoring subscription without valid account metadata or allowed price.');
    return false;
  }
  const rawStatus = forcedStatus || subscription.status;
  const status = ['active', 'trialing'].includes(rawStatus) ? 'active' : 'inactive';
  const customerId = stripeId(subscription.customer);
  const periodEnd = subscriptionPeriodEnd(subscription);
  const priceId = (subscription.items?.data || []).find(item => PRICE_TIERS[item.price?.id])?.price?.id || null;
  const result = await env.DB.prepare(
    'UPDATE accounts SET membership_tier = ?, membership_status = ?, stripe_customer_id = ?, stripe_subscription_id = ?, stripe_price_id = ?, membership_current_period_end = ?, membership_source = ? , updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(tier, status, customerId || null, subscription.id, priceId, periodEnd, 'stripe_test', accountId).run();
  if (!result.meta || result.meta.changes !== 1) {
    console.error('No staging account matched Stripe account_id metadata:', accountId);
    return false;
  }
  return true;
}
export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  if (!env.STRIPE_TEST_SECRET_KEY?.startsWith('sk_test_') || !env.STRIPE_ACCOUNT_TEST_WEBHOOK_SECRET) {
    return json({ ok: false, error: 'test_webhook_not_configured' }, 500);
  }
  const body = await request.text();
  const event = await verifySignature(body, request.headers.get('stripe-signature'), env.STRIPE_ACCOUNT_TEST_WEBHOOK_SECRET);
  if (!event) return json({ ok: false, error: 'invalid_signature' }, 400);
  try {
    const seen = await env.DB.prepare('SELECT event_id FROM stripe_account_events WHERE event_id = ?').bind(event.id).first();
    if (seen) return json({ received: true, duplicate: true });
    let processed = true;
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      const accountId = Number(session.metadata?.account_id || session.client_reference_id || 0);
      const subscriptionId = stripeId(session.subscription);
      if (session.mode !== 'subscription' || !Number.isSafeInteger(accountId) || accountId < 1 || !subscriptionId) {
        processed = false;
      } else {
        const subscription = await fetchSubscription(subscriptionId, env);
        if (!subscription || Number(subscription.metadata?.account_id || 0) !== accountId ||
            !['active', 'trialing'].includes(subscription.status) || !allowedTier(subscription)) {
          processed = false;
        } else {
          processed = await saveSubscription(subscription, env);
        }
      }
    } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      processed = await saveSubscription(event.data.object, env);
    } else if (event.type === 'customer.subscription.deleted') {
      processed = await saveSubscription(event.data.object, env, 'canceled');
    }
    if (!processed) return json({ ok: false, error: 'membership_not_applied' }, 500);
    await env.DB.prepare('INSERT INTO stripe_account_events (event_id, event_type) VALUES (?, ?)').bind(event.id, event.type).run();
    return json({ received: true });
  } catch (error) {
    console.error('Staging membership webhook processing failed:', error);
    return json({ ok: false, error: 'webhook_processing_failed' }, 500);
  }
}
export async function onRequest() { return json({ ok: false, error: 'method_not_allowed' }, 405); }
