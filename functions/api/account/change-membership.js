// POST /api/account/change-membership
// Staging-only: schedule a plan/interval change for the next renewal on the existing Stripe Test Mode subscription.
// This endpoint never creates a new subscription and refuses subscriptions that are already scheduled to cancel/change.
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
const PRICE_DETAILS = Object.fromEntries(
  Object.entries(PRICES).flatMap(([tier, intervals]) =>
    Object.entries(intervals).map(([interval, price]) => [price, { tier, interval }])
  )
);
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
async function stripeRequest(env, path, params, method = 'GET') {
  const options = {
    method,
    headers: { Authorization: 'Bearer ' + env.STRIPE_TEST_SECRET_KEY }
  };
  if (params && method !== 'GET') {
    options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    options.body = params;
  }
  const response = await fetch('https://api.stripe.com/v1' + path, options);
  const result = await response.json();
  return { response, result };
}
function stripeId(value) {
  return typeof value === 'string' ? value : value?.id || '';
}
function periodStart(subscription, item) {
  return Number(item?.current_period_start || subscription?.current_period_start || 0);
}
function periodEnd(subscription, item) {
  return Number(item?.current_period_end || subscription?.current_period_end || 0);
}
function addPhase(params, index, start, end, price, tier, interval) {
  params.set(`phases[${index}][start_date]`, String(start));
  if (end) params.set(`phases[${index}][end_date]`, String(end));
  params.set(`phases[${index}][items][0][price]`, price);
  params.set(`phases[${index}][items][0][quantity]`, '1');
  params.set(`phases[${index}][proration_behavior]`, 'none');
  params.set(`phases[${index}][metadata][account_id]`, '');
  params.set(`phases[${index}][metadata][membership_tier]`, tier);
  params.set(`phases[${index}][metadata][billing_interval]`, interval);
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
      'SELECT id, account_type, session_expires_at, membership_status, membership_tier, membership_interval, membership_cancel_at_period_end, stripe_customer_id, stripe_subscription_id, stripe_price_id FROM accounts WHERE session_token_hash = ? LIMIT 1'
    ).bind(await sha256(token)).first();
    if (!account || !account.session_expires_at || Number(account.session_expires_at) <= Date.now()) {
      return json({ ok: false, error: 'login_required' }, 401);
    }
    if (account.membership_status !== 'active' || !account.stripe_subscription_id) {
      return json({ ok: false, error: 'membership_not_active' }, 409);
    }
    if (Number(account.membership_cancel_at_period_end || 0) === 1) {
      return json({ ok: false, error: 'cancellation_scheduled' }, 409);
    }
    // Paid membership tier is independent of website account type and verification status.

    const targetPrice = PRICES[tier][interval];
    if (targetPrice === account.stripe_price_id) return json({ ok: false, error: 'same_plan_selected' }, 400);

    const { response: subResponse, result: subscription } = await stripeRequest(
      env, '/subscriptions/' + encodeURIComponent(account.stripe_subscription_id)
    );
    if (!subResponse.ok || subscription.id !== account.stripe_subscription_id ||
        stripeId(subscription.customer) !== account.stripe_customer_id ||
        Number(subscription.metadata?.account_id || 0) !== Number(account.id) ||
        !['active', 'trialing'].includes(subscription.status)) {
      console.error('Staging membership change refused: subscription/account verification failed.');
      return json({ ok: false, error: 'subscription_verification_failed' }, 409);
    }
    const items = subscription.items?.data || [];
    if (items.length !== 1 || !items[0]?.price?.id || !PRICE_DETAILS[items[0].price.id]) {
      return json({ ok: false, error: 'unsupported_subscription_items' }, 409);
    }
    if (subscription.cancel_at_period_end) return json({ ok: false, error: 'cancellation_scheduled' }, 409);
    if (stripeId(subscription.schedule)) return json({ ok: false, error: 'change_already_scheduled' }, 409);

    const currentItem = items[0];
    const currentDetails = PRICE_DETAILS[currentItem.price.id];
    const start = periodStart(subscription, currentItem);
    const end = periodEnd(subscription, currentItem);
    if (targetPrice === currentItem.price.id) return json({ ok: false, error: 'same_plan_selected' }, 400);
    if (!Number.isSafeInteger(start) || start < 1 || !Number.isSafeInteger(end) || end <= Math.floor(Date.now() / 1000)) {
      return json({ ok: false, error: 'billing_period_unavailable' }, 409);
    }
    // Only allow known single-item subscriptions without discounts or unusual billing settings.
    // Refuse rather than silently dropping settings when building the future schedule.
    if ((subscription.discounts || []).length ||
        subscription.pending_setup_intent ||
        subscription.billing_mode?.type === 'flexible') {
      return json({ ok: false, error: 'subscription_requires_manual_review' }, 409);
    }

    const { response: createResponse, result: schedule } = await stripeRequest(
      env,
      '/subscription_schedules',
      new URLSearchParams({ from_subscription: subscription.id }),
      'POST'
    );
    if (!createResponse.ok || !schedule.id) {
      console.error('Staging subscription schedule creation failed:', createResponse.status, schedule.error?.type || 'unknown');
      return json({ ok: false, error: 'schedule_creation_failed' }, 502);
    }

    const currentPhase = schedule.phases?.[0];
    const hasSpecialPhaseSettings = Boolean(
      currentPhase?.application_fee_percent != null ||
      currentPhase?.automatic_tax?.enabled ||
      currentPhase?.billing_thresholds ||
      currentPhase?.collection_method && currentPhase.collection_method !== 'charge_automatically' ||
      currentPhase?.default_payment_method ||
      currentPhase?.default_source ||
      (currentPhase?.default_tax_rates || []).length ||
      currentPhase?.description ||
      (currentPhase?.add_invoice_items || []).length ||
      currentPhase?.on_behalf_of ||
      currentPhase?.transfer_data ||
      currentPhase?.trial_end ||
      (currentPhase?.discounts || []).length
    );
    if (hasSpecialPhaseSettings) {
      await stripeRequest(env, '/subscription_schedules/' + encodeURIComponent(schedule.id) + '/release', new URLSearchParams(), 'POST');
      return json({ ok: false, error: 'subscription_requires_manual_review' }, 409);
    }
    const scheduleCurrentStart = Number(currentPhase?.start_date || start);
    if (!Number.isSafeInteger(scheduleCurrentStart) || scheduleCurrentStart < 1) {
      await stripeRequest(env, '/subscription_schedules/' + encodeURIComponent(schedule.id) + '/release', new URLSearchParams(), 'POST');
      return json({ ok: false, error: 'billing_period_unavailable' }, 409);
    }
    const phases = new URLSearchParams();
    phases.set('end_behavior', 'release');
    phases.set('proration_behavior', 'none');
    addPhase(phases, 0, scheduleCurrentStart, end, currentItem.price.id, currentDetails.tier, currentDetails.interval);
    phases.set('phases[0][metadata][account_id]', String(account.id));
    addPhase(phases, 1, end, null, targetPrice, tier, interval);
    phases.set('phases[1][metadata][account_id]', String(account.id));
    // Keep existing subscription-level metadata unchanged until the phase transition.
    // Stripe applies phase metadata at the transition, then the account webhook syncs D1.
    const { response: updateResponse, result: updatedSchedule } = await stripeRequest(
      env,
      '/subscription_schedules/' + encodeURIComponent(schedule.id),
      phases,
      'POST'
    );
    if (!updateResponse.ok || !updatedSchedule.id || !Array.isArray(updatedSchedule.phases) ||
        updatedSchedule.phases.length < 2) {
      // Creating a schedule from an existing subscription attaches it immediately.
      // If configuring the next phase fails, release it so the current subscription is left alone.
      await stripeRequest(
        env,
        '/subscription_schedules/' + encodeURIComponent(schedule.id) + '/release',
        new URLSearchParams(),
        'POST'
      );
      console.error('Staging membership change schedule update failed:', updateResponse.status, updatedSchedule.error?.type || 'unknown');
      return json({ ok: false, error: 'schedule_update_failed' }, 502);
    }
    await env.DB.prepare(
      'UPDATE accounts SET membership_scheduled_tier = ?, membership_scheduled_interval = ?, membership_scheduled_price_id = ?, membership_scheduled_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND stripe_subscription_id = ?'
    ).bind(tier, interval, targetPrice, end, account.id, account.stripe_subscription_id).run();
    return json({
      ok: true,
      scheduled: true,
      current_tier: currentDetails.tier,
      current_interval: currentDetails.interval,
      next_tier: tier,
      next_interval: interval,
      effective_at: end
    });
  } catch (error) {
    console.error('Staging account membership change failed:', error);
    return json({ ok: false, error: 'membership_change_failed' }, 500);
  }
}
export async function onRequest() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
