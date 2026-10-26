import { accountStripeConfig } from '../_lib/account-stripe.js';
import { currentEventPaymentsAccount, ensureEventPaymentsSchema, eventPaymentsJson, getOwnedEvent } from '../_lib/event-payments.js';

async function stripeRequest(path, stripe, options = {}) {
  const response = await fetch('https://api.stripe.com/v1/' + path, {
    method: options.method || 'GET',
    headers: { Authorization: 'Bearer ' + stripe.secretKey, ...(options.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: options.body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('Event Connect Stripe request failed:', response.status, data.error?.type || 'unknown');
    throw new Error('stripe_connect_request_failed');
  }
  return data;
}
async function syncAccountRow(env, accountId, stripeAccount) {
  const requirements = stripeAccount.requirements || {};
  const due = Array.isArray(requirements.currently_due) ? requirements.currently_due : [];
  await env.DB.prepare("INSERT INTO event_connect_accounts (account_id,stripe_account_id,livemode,details_submitted,charges_enabled,payouts_enabled,requirements_due_json,updated_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(account_id) DO UPDATE SET stripe_account_id=excluded.stripe_account_id,livemode=excluded.livemode,details_submitted=excluded.details_submitted,charges_enabled=excluded.charges_enabled,payouts_enabled=excluded.payouts_enabled,requirements_due_json=excluded.requirements_due_json,updated_at=CURRENT_TIMESTAMP")
    .bind(accountId, stripeAccount.id, stripeAccount.livemode ? 1 : 0, stripeAccount.details_submitted ? 1 : 0, stripeAccount.charges_enabled ? 1 : 0, stripeAccount.payouts_enabled ? 1 : 0, JSON.stringify(due)).run();
  return { stripe_account_id: stripeAccount.id, livemode: !!stripeAccount.livemode, details_submitted: !!stripeAccount.details_submitted, charges_enabled: !!stripeAccount.charges_enabled, payouts_enabled: !!stripeAccount.payouts_enabled, currently_due: due, connected: !!stripeAccount.charges_enabled && !!stripeAccount.payouts_enabled };
}
async function findAndSync(env, accountId, stripe, known = null) {
  const row = known || await env.DB.prepare('SELECT * FROM event_connect_accounts WHERE account_id=? LIMIT 1').bind(accountId).first();
  if (!row) return { connected: false, details_submitted: false, charges_enabled: false, payouts_enabled: false, currently_due: [] };
  const stripeAccount = await stripeRequest('accounts/' + encodeURIComponent(row.stripe_account_id), stripe);
  return syncAccountRow(env, accountId, stripeAccount);
}
async function createOnboardingLink(env, account, eventId, stripe) {
  let row = await env.DB.prepare('SELECT * FROM event_connect_accounts WHERE account_id=? LIMIT 1').bind(account.id).first();
  if (!row) {
    const params = new URLSearchParams();
    params.set('type', 'express');
    params.set('country', 'US');
    if (account.email) params.set('email', account.email);
    params.set('capabilities[card_payments][requested]', 'true');
    params.set('capabilities[transfers][requested]', 'true');
    params.set('metadata[ppp_account_id]', String(account.id));
    params.set('metadata[ppp_use]', 'event_admissions_booths');
    const created = await stripeRequest('accounts', stripe, { method: 'POST', body: params });
    if (!created.id) throw new Error('stripe_account_creation_failed');
    await syncAccountRow(env, account.id, created);
    row = await env.DB.prepare('SELECT * FROM event_connect_accounts WHERE account_id=? LIMIT 1').bind(account.id).first();
  } else if (Number(row.livemode) !== (stripe.live ? 1 : 0)) {
    return { error: 'stripe_account_mode_mismatch' };
  }
  const origin = stripe.origin || 'https://pokeprizepool.com';
  const page = origin + '/event.html?id=' + encodeURIComponent(eventId);
  const params = new URLSearchParams();
  params.set('account', row.stripe_account_id);
  params.set('type', 'account_onboarding');
  params.set('return_url', page + '&connect=return');
  params.set('refresh_url', page + '&connect=refresh');
  const link = await stripeRequest('account_links', stripe, { method: 'POST', body: params });
  return { url: link.url, expires_at: link.expires_at || null };
}
export async function onRequestGet({ request, env }) {
  if (!env.DB) return eventPaymentsJson({ ok: false, error: 'database_not_configured' }, 500);
  const user = await currentEventPaymentsAccount(request, env);
  if (!user) return eventPaymentsJson({ ok: false, error: 'login_required' }, 401);
  const eventId = Number(new URL(request.url).searchParams.get('event_id') || 0);
  if (!Number.isSafeInteger(eventId) || eventId < 1) return eventPaymentsJson({ ok: false, error: 'valid_event_id_required' }, 400);
  try {
    await ensureEventPaymentsSchema(env);
    const event = await getOwnedEvent(env, eventId, user);
    if (!event) return eventPaymentsJson({ ok: false, error: 'event_manage_forbidden' }, 403);
    const stripe = accountStripeConfig(env);
    if (!stripe) return eventPaymentsJson({ ok: true, configured: false, connected: false, message: 'Stripe Connect is not configured for this environment.' });
    const connect = await findAndSync(env, Number(user.id), stripe);
    const webhookSecret = stripe.live ? env.STRIPE_EVENT_CONNECT_WEBHOOK_SECRET : env.STRIPE_EVENT_CONNECT_TEST_WEBHOOK_SECRET;
    return eventPaymentsJson({ ok: true, configured: true, webhook_ready: !!webhookSecret, payments_ready: !!connect.connected && !!webhookSecret, ...connect });
  } catch (error) {
    console.error('Event Connect status read failed:', error);
    return eventPaymentsJson({ ok: false, error: 'event_connect_unavailable' }, 500);
  }
}
export async function onRequestPost({ request, env }) {
  if (!env.DB) return eventPaymentsJson({ ok: false, error: 'database_not_configured' }, 500);
  const user = await currentEventPaymentsAccount(request, env);
  if (!user) return eventPaymentsJson({ ok: false, error: 'login_required' }, 401);
  const originHeader = request.headers.get('Origin');
  if (originHeader) {
    try { if (new URL(originHeader).origin !== new URL(request.url).origin) return eventPaymentsJson({ ok: false, error: 'origin_not_allowed' }, 403); }
    catch { return eventPaymentsJson({ ok: false, error: 'origin_not_allowed' }, 403); }
  }
  let data;
  try { data = await request.json(); } catch { return eventPaymentsJson({ ok: false, error: 'bad_request' }, 400); }
  const eventId = Number(data.event_id || 0);
  if (!Number.isSafeInteger(eventId) || eventId < 1) return eventPaymentsJson({ ok: false, error: 'valid_event_id_required' }, 400);
  try {
    await ensureEventPaymentsSchema(env);
    const event = await getOwnedEvent(env, eventId, user);
    if (!event) return eventPaymentsJson({ ok: false, error: 'event_manage_forbidden' }, 403);
    const stripe = accountStripeConfig(env);
    if (!stripe) return eventPaymentsJson({ ok: false, error: 'stripe_connect_not_configured', message: 'Stripe payments are not configured for this environment yet.' }, 503);
    if (data.action !== 'start_onboarding') return eventPaymentsJson({ ok: false, error: 'unknown_action' }, 400);
    const result = await createOnboardingLink(env, user, eventId, stripe);
    if (result.error) return eventPaymentsJson({ ok: false, error: result.error, message: 'Your Stripe connection belongs to a different Stripe mode. Contact PokePrizePool support before continuing.' }, 409);
    return eventPaymentsJson({ ok: true, url: result.url, expires_at: result.expires_at });
  } catch (error) {
    console.error('Event Connect onboarding failed:', error);
    return eventPaymentsJson({ ok: false, error: 'event_connect_onboarding_failed', message: 'Stripe onboarding could not be opened. Please try again or contact support.' }, 502);
  }
}
export async function onRequest() { return eventPaymentsJson({ ok: false, error: 'method_not_allowed' }, 405); }
