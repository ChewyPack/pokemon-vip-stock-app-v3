import { accountStripeConfig } from '../_lib/account-stripe.js';
import { ensureEventPaymentsSchema, eventPaymentsJson } from '../_lib/event-payments.js';

async function verifySignature(payload, header, secret) {
  if (!secret || !header) return null;
  const parts = header.split(',');
  const timestamp = parts.find(part => part.startsWith('t='))?.slice(2);
  const signatures = parts.filter(part => part.startsWith('v1=')).map(part => part.slice(3));
  if (!timestamp || !/^\d+$/.test(timestamp) || !signatures.length || Math.abs(Date.now()/1000-Number(timestamp)) > 300) return null;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(timestamp + '.' + payload));
  const expected = Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2,'0')).join('');
  if (!signatures.some(value => value.length === expected.length && /^[a-f0-9]+$/i.test(value) && value.toLowerCase() === expected)) return null;
  try { return JSON.parse(payload); } catch { return null; }
}
function stripeId(value) { return typeof value === 'string' ? value : value?.id || ''; }
async function releaseReservation(env, order, nextStatus, update = {}) {
  const buyerEmail = update.buyerEmail ?? '';
  const buyerName = update.buyerName ?? '';
  const paymentIntent = update.paymentIntent ?? '';
  await env.DB.batch([
    env.DB.prepare("UPDATE event_sale_items SET quantity_reserved=MAX(0,quantity_reserved-COALESCE((SELECT quantity FROM event_sale_orders WHERE id=? AND reservation_released=0),0)) WHERE id=(SELECT item_id FROM event_sale_orders WHERE id=?)").bind(order.id,order.id),
    env.DB.prepare("UPDATE event_sale_orders SET status=?,reservation_released=1,buyer_email=CASE WHEN ?='' THEN buyer_email ELSE ? END,buyer_name=CASE WHEN ?='' THEN buyer_name ELSE ? END,stripe_payment_intent_id=COALESCE(NULLIF(? ,''),stripe_payment_intent_id),updated_at=CURRENT_TIMESTAMP WHERE id=? AND reservation_released=0").bind(nextStatus,buyerEmail,buyerEmail,buyerName,buyerName,paymentIntent,order.id)
  ]);
}
async function stripeAccountGet(path, stripe, connectedAccountId) {
  const response = await fetch('https://api.stripe.com/v1/' + path, { headers: { Authorization: 'Bearer ' + stripe.secretKey, 'Stripe-Account': connectedAccountId } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('stripe_connected_resource_lookup_failed');
  return data;
}
async function orderByPaymentIntent(env, event, paymentIntentId, metadata = {}) {
  let orderId = Number(metadata.ppp_event_sale_order_id || 0);
  let order = orderId > 0 ? await env.DB.prepare('SELECT * FROM event_sale_orders WHERE id=? LIMIT 1').bind(orderId).first() : null;
  if (!order && paymentIntentId) order = await env.DB.prepare('SELECT * FROM event_sale_orders WHERE stripe_payment_intent_id=? LIMIT 1').bind(paymentIntentId).first();
  if (!order) return null;
  if (String(event.account || '') !== String(order.connected_account_id || '')) return false;
  if (paymentIntentId && order.stripe_payment_intent_id !== paymentIntentId) {
    await env.DB.prepare('UPDATE event_sale_orders SET stripe_payment_intent_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND (stripe_payment_intent_id IS NULL OR stripe_payment_intent_id=?)')
      .bind(paymentIntentId,order.id,paymentIntentId).run();
    order.stripe_payment_intent_id=paymentIntentId;
  }
  return order;
}
async function applyPaymentIntent(env, event, intent) {
  const connectedAccountId = String(event.account || '');
  if (!connectedAccountId) return false;
  const order = await orderByPaymentIntent(env,event,String(intent.id || ''),intent.metadata || {});
  if (order === false) return false;
  if (!order) return true;
  return true;
}
async function applyCheckoutSession(env, event, session) {
  const orderId = Number(session.metadata?.ppp_event_sale_order_id || 0);
  if (!Number.isSafeInteger(orderId) || orderId < 1) return true;
  const connectedAccountId = String(event.account || '');
  if (!connectedAccountId) return false;
  const order = await env.DB.prepare('SELECT * FROM event_sale_orders WHERE id=? LIMIT 1').bind(orderId).first();
  if (!order) return false;
  if (order.connected_account_id !== connectedAccountId) return false;
  if (Number(session.metadata?.ppp_event_id || 0) !== Number(order.event_id) || Number(session.metadata?.ppp_event_sale_item_id || 0) !== Number(order.item_id)) return false;
  if (session.id && order.stripe_checkout_session_id && session.id !== order.stripe_checkout_session_id) return false;
  if (Number(session.amount_total || 0) !== Number(order.total_amount_cents) || String(session.currency || '').toLowerCase() !== 'usd') return false;
  const paymentIntent = stripeId(session.payment_intent);
  const buyerEmail = String(session.customer_details?.email || session.customer_email || '').trim().slice(0,320);
  const buyerName = String(session.customer_details?.name || '').trim().slice(0,200);
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    if (session.payment_status === 'paid' || event.type === 'checkout.session.async_payment_succeeded') {
      if (order.reservation_released && ['paid','partially_refunded','refunded','disputed','dispute_won','dispute_lost'].includes(order.status)) {
        await env.DB.prepare("UPDATE event_sale_orders SET buyer_email=CASE WHEN ?='' THEN buyer_email ELSE ? END,buyer_name=CASE WHEN ?='' THEN buyer_name ELSE ? END,stripe_payment_intent_id=COALESCE(NULLIF(? ,''),stripe_payment_intent_id),updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(buyerEmail,buyerEmail,buyerName,buyerName,paymentIntent,order.id).run();
        return true;
      }
      await releaseReservation(env, order, 'paid', { buyerEmail, buyerName, paymentIntent });
    } else {
      await env.DB.prepare("UPDATE event_sale_orders SET status='processing',buyer_email=CASE WHEN ?='' THEN buyer_email ELSE ? END,buyer_name=CASE WHEN ?='' THEN buyer_name ELSE ? END,stripe_payment_intent_id=COALESCE(NULLIF(? ,''),stripe_payment_intent_id),updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending' AND reservation_released=0")
        .bind(buyerEmail,buyerEmail,buyerName,buyerName,paymentIntent,order.id).run();
    }
  } else if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
    if (!order.reservation_released) await releaseReservation(env, order, event.type === 'checkout.session.expired' ? 'expired' : 'failed');
  }
  return true;
}
async function applyChargeUpdate(env, event, charge, stripe) {
  const connectedAccountId = String(event.account || '');
  if (!connectedAccountId) return false;
  let chargeObject = charge;
  if (event.type.startsWith('charge.dispute.') && charge.charge) {
    chargeObject = await stripeAccountGet('charges/' + encodeURIComponent(stripeId(charge.charge)), stripe, connectedAccountId);
  }
  let paymentIntentId = stripeId(chargeObject.payment_intent || charge.payment_intent);
  let intent = null;
  if ((!paymentIntentId || !chargeObject.metadata?.ppp_event_sale_order_id) && chargeObject.id) {
    if (paymentIntentId) {
      intent = await stripeAccountGet('payment_intents/' + encodeURIComponent(paymentIntentId), stripe, connectedAccountId).catch(() => null);
    }
  }
  if (!paymentIntentId && intent) paymentIntentId = stripeId(intent.id);
  const metadata = chargeObject.metadata || intent?.metadata || charge.metadata || {};
  const order = await orderByPaymentIntent(env,event,paymentIntentId,metadata);
  if (order === false) return false;
  if (!order) return true;
  if (event.type === 'charge.succeeded') {
    if (Number(chargeObject.amount || 0) !== Number(order.total_amount_cents || 0) || String(chargeObject.currency || '').toLowerCase() !== 'usd') return false;
    let balanceTransaction = chargeObject.balance_transaction && typeof chargeObject.balance_transaction === 'object' ? chargeObject.balance_transaction : null;
    const balanceTransactionId = stripeId(chargeObject.balance_transaction);
    if (!balanceTransaction && balanceTransactionId) balanceTransaction = await stripeAccountGet('balance_transactions/' + encodeURIComponent(balanceTransactionId), stripe, connectedAccountId);
    if (balanceTransaction) {
      const fee = Number(balanceTransaction.fee || 0);
      const net = Number(balanceTransaction.net ?? balanceTransaction.amount ?? (Number(chargeObject.amount || 0) - fee));
      await env.DB.prepare('UPDATE event_sale_orders SET stripe_fee_cents=?,net_amount_cents=?,stripe_balance_transaction_id=?,stripe_payment_intent_id=COALESCE(NULLIF(? ,\'\'),stripe_payment_intent_id),updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .bind(fee,net,balanceTransactionId || stripeId(balanceTransaction.id),paymentIntentId,order.id).run();
    }
    if (!order.reservation_released) await releaseReservation(env, order, 'paid', { paymentIntent: paymentIntentId });
    return true;
  }
  if (event.type === 'charge.refunded') {
    const refunded = Math.max(0, Number(charge.amount_refunded || 0));
    const full = refunded >= Number(order.total_amount_cents || 0);
    await env.DB.prepare("UPDATE event_sale_orders SET amount_refunded_cents=?,status=CASE WHEN ?=1 THEN 'refunded' ELSE 'partially_refunded' END,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(refunded, full ? 1 : 0, order.id).run();
  } else if (event.type === 'charge.dispute.created') {
    if (order.status !== 'refunded') await env.DB.prepare("UPDATE event_sale_orders SET status='disputed',dispute_status='open',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(order.id).run();
  } else if (event.type === 'charge.dispute.closed') {
    const status = String(charge.dispute?.status || charge.status || '').toLowerCase();
    const disputeResult = status === 'won' ? 'dispute_won' : (status === 'lost' ? 'dispute_lost' : 'paid');
    await env.DB.prepare('UPDATE event_sale_orders SET status=?,dispute_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status<>\'refunded\'')
      .bind(disputeResult,status,order.id).run();
  }
  return true;
}
async function syncConnectAccount(env, accountId, stripeAccount) {
  const requirements = stripeAccount.requirements || {};
  await env.DB.prepare("UPDATE event_connect_accounts SET details_submitted=?,charges_enabled=?,payouts_enabled=?,requirements_due_json=?,livemode=?,updated_at=CURRENT_TIMESTAMP WHERE stripe_account_id=?")
    .bind(stripeAccount.details_submitted?1:0,stripeAccount.charges_enabled?1:0,stripeAccount.payouts_enabled?1:0,JSON.stringify(Array.isArray(requirements.currently_due)?requirements.currently_due:[]),stripeAccount.livemode?1:0,accountId).run();
}
async function recordPayout(env, event) {
  const accountId = String(event.account || '');
  const payout = event.data?.object || {};
  if (!accountId || !payout.id) return true;
  const owner = await env.DB.prepare('SELECT account_id FROM event_connect_accounts WHERE stripe_account_id=? LIMIT 1').bind(accountId).first();
  const type = event.type;
  const status = type === 'payout.paid' ? 'paid' : (type === 'payout.failed' ? 'failed' : (type === 'payout.canceled' ? 'canceled' : String(payout.status || 'pending')));
  await env.DB.prepare("INSERT INTO event_connect_payout_activity (stripe_payout_id,connected_account_id,owner_account_id,amount_cents,currency,status,arrival_date,failure_code,updated_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(stripe_payout_id) DO UPDATE SET status=excluded.status,arrival_date=excluded.arrival_date,failure_code=excluded.failure_code,updated_at=CURRENT_TIMESTAMP")
    .bind(payout.id,accountId,owner?.account_id || null,Number(payout.amount || 0),String(payout.currency || 'usd'),status,payout.arrival_date ? new Date(Number(payout.arrival_date)*1000).toISOString() : null,String(payout.failure_code || '')).run();
  return true;
}
export async function onRequestPost({ request, env }) {
  if (!env.DB) return eventPaymentsJson({ ok: false, error: 'database_not_configured' }, 500);
  const stripe = accountStripeConfig(env);
  if (!stripe) return eventPaymentsJson({ ok: false, error: 'stripe_connect_not_configured' }, 503);
  const secret = stripe.live ? env.STRIPE_EVENT_CONNECT_WEBHOOK_SECRET : env.STRIPE_EVENT_CONNECT_TEST_WEBHOOK_SECRET;
  if (!secret) return eventPaymentsJson({ ok: false, error: 'event_connect_webhook_not_configured' }, 500);
  const raw = await request.text();
  const event = await verifySignature(raw, request.headers.get('stripe-signature'), secret);
  if (!event) return eventPaymentsJson({ ok: false, error: 'invalid_signature' }, 400);
  try {
    await ensureEventPaymentsSchema(env);
    const seen = await env.DB.prepare('SELECT event_id FROM event_connect_webhook_events WHERE event_id=? LIMIT 1').bind(event.id).first();
    if (seen) return eventPaymentsJson({ received: true, duplicate: true });
    const object = event.data?.object || {};
    let processed = true;
    if (event.type === 'account.updated') {
      const connectedId = String(event.account || object.id || '');
      if (connectedId) await syncConnectAccount(env, connectedId, object);
    } else if (event.type.startsWith('checkout.session.')) {
      processed = await applyCheckoutSession(env, event, object);
    } else if (event.type === 'payment_intent.succeeded') {
      processed = await applyPaymentIntent(env,event,object);
    } else if (['charge.succeeded','charge.refunded','charge.dispute.created','charge.dispute.closed'].includes(event.type)) {
      processed = await applyChargeUpdate(env, event, object, stripe);
    } else if (['payout.created','payout.updated','payout.paid','payout.failed','payout.canceled'].includes(event.type)) {
      processed = await recordPayout(env, event);
    }
    if (!processed) return eventPaymentsJson({ ok: false, error: 'event_connect_webhook_mismatch' }, 500);
    await env.DB.prepare('INSERT OR IGNORE INTO event_connect_webhook_events (event_id,event_type) VALUES (?,?)').bind(event.id,event.type).run();
    return eventPaymentsJson({ received: true });
  } catch (error) {
    console.error('Event Connect webhook processing failed:', error);
    return eventPaymentsJson({ ok: false, error: 'event_connect_webhook_failed' }, 500);
  }
}
export async function onRequest() { return eventPaymentsJson({ ok: false, error: 'method_not_allowed' }, 405); }
