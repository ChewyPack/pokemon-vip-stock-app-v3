/*
 * POST /api/stripe-account
 * Account-membership webhook. Test Mode is the default; live mode requires its own secret.
 * This handler deliberately ignores legacy VIP events without account_id metadata.
 */
import { accountStripeConfig } from '../_lib/account-stripe.js';
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
function allowedTier(subscription, priceTiers) {
  const items = subscription?.items?.data || [];
  const tiers = [...new Set(items.map(item => priceTiers[item.price?.id]).filter(Boolean))];
  const allAllowed = items.length > 0 && items.every(item => priceTiers[item.price?.id]);
  if (!allAllowed || tiers.length !== 1) return '';
  return tiers[0];
}
async function fetchSubscription(id, stripe) {
  if (!id) return null;
  const response = await fetch('https://api.stripe.com/v1/subscriptions/' + encodeURIComponent(id), {
    headers: { Authorization: 'Bearer ' + stripe.secretKey }
  });
  if (!response.ok) {
    console.error('Could not verify Stripe subscription:', response.status);
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
async function saveSubscription(subscription, env, stripe, forcedStatus) {
  const accountId = Number(subscription?.metadata?.account_id || 0);
  const tier = allowedTier(subscription, stripe.priceTiers);
  if (!Number.isSafeInteger(accountId) || accountId < 1 || !tier) {
    console.error('Ignoring subscription without valid account metadata or allowed price.');
    return false;
  }
  const rawStatus = forcedStatus || subscription.status;
  const status = ['active', 'trialing'].includes(rawStatus) ? 'active' : 'inactive';
  const customerId = stripeId(subscription.customer);
  const periodEnd = subscriptionPeriodEnd(subscription);
  const interval = subscription?.metadata?.billing_interval === 'yearly' ? 'yearly' : (subscription?.metadata?.billing_interval === 'monthly' ? 'monthly' : ((subscription?.items?.data || []).some(item => item.price?.recurring?.interval === 'year') ? 'yearly' : 'monthly'));
  const cancelAtPeriodEnd = subscription?.cancel_at_period_end ? 1 : 0;
  const priceId = (subscription.items?.data || []).find(item => stripe.priceTiers[item.price?.id])?.price?.id || null;
  const result = await env.DB.prepare(
    'UPDATE accounts SET membership_tier = ?, membership_entitlement_tier = CASE WHEN membership_scheduled_price_id = ? THEN ? ELSE CASE WHEN LOWER(TRIM(COALESCE(membership_entitlement_tier, ''))) IN ('', 'free', 'none', 'inactive') THEN ? ELSE membership_entitlement_tier END END, membership_status = ?, stripe_customer_id = ?, stripe_subscription_id = ?, stripe_price_id = ?, membership_current_period_end = ?, membership_source = ?, membership_interval = ?, membership_cancel_at_period_end = ?, membership_scheduled_tier = CASE WHEN membership_scheduled_price_id = ? THEN NULL ELSE membership_scheduled_tier END, membership_scheduled_interval = CASE WHEN membership_scheduled_price_id = ? THEN NULL ELSE membership_scheduled_interval END, membership_scheduled_price_id = CASE WHEN membership_scheduled_price_id = ? THEN NULL ELSE membership_scheduled_price_id END, membership_scheduled_at = CASE WHEN membership_scheduled_price_id = ? THEN NULL ELSE membership_scheduled_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(tier, priceId, tier, tier, status, customerId || null, subscription.id, priceId, periodEnd, stripe.source, interval, cancelAtPeriodEnd, priceId, priceId, priceId, priceId, accountId).run();
  if (!result.meta || result.meta.changes !== 1) {
    console.error('No website account matched Stripe account_id metadata:', accountId);
    return false;
  }
  return true;
}
export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  const stripe = accountStripeConfig(env);
  if (!stripe || !stripe.webhookSecret) return json({ ok: false, error: 'account_webhook_not_configured' }, 500);
  const body = await request.text();
  const event = await verifySignature(body, request.headers.get('stripe-signature'), stripe.webhookSecret);
  if (!event) return json({ ok: false, error: 'invalid_signature' }, 400);
  try {
    const seen = await env.DB.prepare('SELECT event_id FROM stripe_account_events WHERE event_id = ?').bind(event.id).first();
    if (seen) return json({ received: true, duplicate: true });
    let processed = true;
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      const rawAccountId = session.metadata?.account_id;
      // The legacy VIP checkout has no account_id metadata. Ignore those events here.
      if (!rawAccountId) {
        processed = true;
      } else {
        const accountId = Number(rawAccountId);
        const subscriptionId = stripeId(session.subscription);
        if (session.mode !== 'subscription' || !Number.isSafeInteger(accountId) || accountId < 1 || !subscriptionId) {
          processed = false;
        } else {
          const subscription = await fetchSubscription(subscriptionId, stripe);
          if (!subscription || Number(subscription.metadata?.account_id || 0) !== accountId ||
              !['active', 'trialing'].includes(subscription.status) || !allowedTier(subscription, stripe.priceTiers)) {
            processed = false;
          } else {
            processed = await saveSubscription(subscription, env, stripe);
          }
        }
      }
    } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      const subscription = event.data.object;
      processed = !subscription?.metadata?.account_id || await saveSubscription(subscription, env, stripe);
    } else if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      processed = !subscription?.metadata?.account_id || await saveSubscription(subscription, env, stripe, 'canceled');
    }
    if (!processed) return json({ ok: false, error: 'membership_not_applied' }, 500);
    await env.DB.prepare('INSERT INTO stripe_account_events (event_id, event_type) VALUES (?, ?)').bind(event.id, event.type).run();
    return json({ received: true });
  } catch (error) {
    console.error('Account membership webhook processing failed:', error);
    return json({ ok: false, error: 'webhook_processing_failed' }, 500);
  }
}
export async function onRequest() { return json({ ok: false, error: 'method_not_allowed' }, 405); }
