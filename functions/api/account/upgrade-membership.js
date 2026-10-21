// POST /api/account/upgrade-membership
// Preview estimates and applies immediate upgrades; live mode is separately gated.
import { accountStripeConfig, accountStripeConfigError, priceDetailsFor } from '../../_lib/account-stripe.js';
const COOKIE = 'collector_session';
const RANK = { collector_plus: 1, vendor: 2, organizer: 3 };
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
function getCookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const p = part.trim();
    if (p.startsWith(name + '=')) return p.slice(name.length + 1);
  }
  return '';
}
function b64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(value) {
  return b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
async function stripeRequest(stripe, path, params, method = 'GET') {
  const options = { method, headers: { Authorization: 'Bearer ' + stripe.secretKey } };
  if (params && method !== 'GET') {
    options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    options.body = params;
  }
  const response = await fetch('https://api.stripe.com/v1' + path, options);
  const result = await response.json();
  return { response, result };
}
function stripeId(value) { return typeof value === 'string' ? value : value?.id || ''; }
export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  const stripe = accountStripeConfig(env);
  if (!stripe) return json({ ok: false, error: accountStripeConfigError(env) }, 503);
  const PRICES = stripe.prices;
  const PRICE_DETAILS = priceDetailsFor(PRICES);
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'bad_request' }, 400); }
  const action = data.action;
  const tier = typeof data.tier === 'string' ? data.tier : '';
  const interval = typeof data.interval === 'string' ? data.interval : '';
  const prorationDate = Number(data.proration_date || 0);
  if (!['preview', 'apply'].includes(action) || !Object.hasOwn(PRICES, tier) ||
      !['monthly', 'yearly'].includes(interval)) return json({ ok: false, error: 'invalid_plan' }, 400);
  const token = getCookie(request, COOKIE);
  if (!token) return json({ ok: false, error: 'login_required' }, 401);
  try {
    const account = await env.DB.prepare(
      'SELECT id, session_expires_at, membership_status, membership_tier, membership_interval, membership_cancel_at_period_end, stripe_customer_id, stripe_subscription_id, stripe_price_id FROM accounts WHERE session_token_hash = ? LIMIT 1'
    ).bind(await sha256(token)).first();
    if (!account || !account.session_expires_at || Number(account.session_expires_at) <= Date.now()) return json({ ok: false, error: 'login_required' }, 401);
    if (account.membership_status !== 'active' || !account.stripe_subscription_id) return json({ ok: false, error: 'membership_not_active' }, 409);
    if (Number(account.membership_cancel_at_period_end || 0) === 1) return json({ ok: false, error: 'cancellation_scheduled' }, 409);

    const { response: subResponse, result: sub } = await stripeRequest(stripe, '/subscriptions/' + encodeURIComponent(account.stripe_subscription_id));
    if (!subResponse.ok || sub.id !== account.stripe_subscription_id || stripeId(sub.customer) !== account.stripe_customer_id ||
        Number(sub.metadata?.account_id || 0) !== Number(account.id) || !['active', 'trialing'].includes(sub.status)) {
      return json({ ok: false, error: 'subscription_verification_failed' }, 409);
    }
    const items = sub.items?.data || [];
    if (items.length !== 1 || !PRICE_DETAILS[items[0]?.price?.id]) return json({ ok: false, error: 'unsupported_subscription_items' }, 409);
    if (sub.cancel_at_period_end) return json({ ok: false, error: 'cancellation_scheduled' }, 409);
    if (stripeId(sub.schedule)) return json({ ok: false, error: 'change_already_scheduled' }, 409);
    if ((sub.discounts || []).length) return json({ ok: false, error: 'subscription_has_discounts_manual_review' }, 409);
    if (sub.pending_setup_intent) return json({ ok: false, error: 'subscription_has_pending_setup_manual_review' }, 409);

    const currentItem = items[0];
    const current = PRICE_DETAILS[currentItem.price.id];
    const targetPrice = PRICES[tier][interval];
    if (!targetPrice) return json({ ok: false, error: 'plan_not_configured' }, 503);
    if (targetPrice === currentItem.price.id) return json({ ok: false, error: 'same_plan_selected' }, 400);
    if (RANK[tier] <= RANK[current.tier]) return json({ ok: false, error: 'not_an_upgrade' }, 400);
    if (sub.collection_method !== 'charge_automatically') return json({ ok: false, error: 'unsupported_subscription_items' }, 409);

    if (action === 'preview') {
      const now = Math.floor(Date.now() / 1000);
      const params = new URLSearchParams();
      params.set('subscription', sub.id);
      params.set('subscription_details[items][0][id]', currentItem.id);
      params.set('subscription_details[items][0][price]', targetPrice);
      params.set('subscription_details[items][0][quantity]', String(currentItem.quantity || 1));
      params.set('subscription_details[proration_behavior]', 'always_invoice');
      params.set('subscription_details[proration_date]', String(now));
      const { response, result } = await stripeRequest(stripe, '/invoices/create_preview', params, 'POST');
      if (!response.ok || typeof result.total !== 'number') {
        console.error('Staging upgrade invoice preview failed:', response.status, result.error?.type || 'unknown');
        return json({ ok: false, error: 'upgrade_preview_failed' }, 502);
      }
      return json({
        ok: true, action: 'preview', amount_due: result.amount_due ?? result.total,
        currency: result.currency || 'usd', proration_date: now,
        current_tier: current.tier, current_interval: current.interval,
        next_tier: tier, next_interval: interval
      });
    }

    if (!Number.isSafeInteger(prorationDate) || prorationDate < Math.floor(Date.now() / 1000) - 300 ||
        prorationDate > Math.floor(Date.now() / 1000) + 300) {
      return json({ ok: false, error: 'upgrade_preview_expired' }, 409);
    }
    const params = new URLSearchParams();
    params.set('items[0][id]', currentItem.id);
    params.set('items[0][price]', targetPrice);
    params.set('items[0][quantity]', String(currentItem.quantity || 1));
    params.set('proration_behavior', 'always_invoice');
    params.set('proration_date', String(prorationDate));
    params.set('payment_behavior', 'error_if_incomplete');
    params.set('metadata[account_id]', String(account.id));
    params.set('metadata[membership_tier]', tier);
    params.set('metadata[billing_interval]', interval);
    const { response, result } = await stripeRequest(stripe, '/subscriptions/' + encodeURIComponent(sub.id), params, 'POST');
    if (!response.ok || !result.id || !['active', 'trialing'].includes(result.status) ||
        result.items?.data?.[0]?.price?.id !== targetPrice) {
      console.error('Staging immediate upgrade was not applied:', response.status, result.error?.type || result.status || 'unknown');
      return json({ ok: false, error: response.status === 402 ? 'upgrade_payment_failed' : 'upgrade_apply_failed' }, response.status === 402 ? 402 : 502);
    }
    // Stripe has confirmed the immediate upgrade. Synchronize the account's
    // billing tier AND entitlement tier now so Vendor+ tools unlock immediately,
    // without waiting for a webhook delivery or the next renewal.
    try {
      const synced = await env.DB.prepare(
        "UPDATE accounts SET membership_tier = ?, membership_entitlement_tier = ?, membership_interval = ?, stripe_price_id = ?, membership_status = 'active', membership_scheduled_tier = NULL, membership_scheduled_interval = NULL, membership_scheduled_price_id = NULL, membership_scheduled_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND stripe_subscription_id = ?"
      ).bind(tier, tier, interval, targetPrice, account.id, sub.id).run();
      if (!synced.meta || Number(synced.meta.changes || 0) !== 1) {
        console.error('Stripe upgrade succeeded but account entitlement sync did not update exactly one account:', account.id);
        return json({ ok: false, error: 'upgrade_applied_entitlement_sync_failed', stripe_updated: true }, 502);
      }
    } catch (syncError) {
      console.error('Stripe upgrade succeeded but account entitlement sync failed:', syncError);
      return json({ ok: false, error: 'upgrade_applied_entitlement_sync_failed', stripe_updated: true }, 502);
    }
    return json({ ok: true, applied: true, tier, interval, entitlement_active: true, subscription_status: result.status });
  } catch (error) {
    console.error('Staging immediate membership upgrade failed:', error);
    return json({ ok: false, error: 'membership_upgrade_failed' }, 500);
  }
}
export async function onRequest() { return json({ ok: false, error: 'method_not_allowed' }, 405); }
