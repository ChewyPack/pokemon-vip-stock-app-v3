import { accountStripeConfig } from '../_lib/account-stripe.js';
import { currentEventPaymentsAccount, ensureEventPaymentsSchema, eventPaymentsJson, cleanupExpiredEventReservations } from '../_lib/event-payments.js';

export async function onRequestPost({ request, env }) {
  if (!env.DB) return eventPaymentsJson({ ok: false, error: 'database_not_configured' }, 500);
  const originHeader = request.headers.get('Origin');
  if (originHeader) {
    try { if (new URL(originHeader).origin !== new URL(request.url).origin) return eventPaymentsJson({ ok: false, error: 'origin_not_allowed' }, 403); }
    catch { return eventPaymentsJson({ ok: false, error: 'origin_not_allowed' }, 403); }
  }
  const stripe = accountStripeConfig(env);
  if (!stripe) return eventPaymentsJson({ ok: false, error: 'stripe_connect_not_configured', message: 'Event payments are not configured yet.' }, 503);
  const connectWebhookSecret = stripe.live ? env.STRIPE_EVENT_CONNECT_WEBHOOK_SECRET : env.STRIPE_EVENT_CONNECT_TEST_WEBHOOK_SECRET;
  if (!connectWebhookSecret) return eventPaymentsJson({ ok: false, error: 'event_payment_tracking_not_configured', message: 'PokePrizePool is still configuring event payment tracking. Please try again later.' }, 503);
  let data;
  try { data = await request.json(); } catch { return eventPaymentsJson({ ok: false, error: 'bad_request' }, 400); }
  const itemId = Number(data.item_id || 0);
  const quantity = Number(data.quantity || 1);
  if (!Number.isSafeInteger(itemId) || itemId < 1 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) {
    return eventPaymentsJson({ ok: false, error: 'invalid_item_or_quantity', message: 'Choose a listing and a quantity from 1 to 10.' }, 400);
  }
  try {
    await ensureEventPaymentsSchema(env);
    await cleanupExpiredEventReservations(env.DB);
    const item = await env.DB.prepare("SELECT i.*,e.title AS event_title,e.event_date,e.status AS event_status FROM event_sale_items i JOIN poke_report_events e ON e.id=i.event_id WHERE i.id=? LIMIT 1").bind(itemId).first();
    if (!item || Number(item.is_active) !== 1 || item.event_status !== 'published') return eventPaymentsJson({ ok: false, error: 'sale_item_unavailable', message: 'This ticket or booth reservation is no longer available.' }, 404);
    if (String(item.event_date || '') < new Date().toISOString().slice(0, 10)) return eventPaymentsJson({ ok: false, error: 'event_is_past', message: 'Reservations are closed for this event.' }, 409);
    const connected = await env.DB.prepare('SELECT stripe_account_id,livemode,charges_enabled,payouts_enabled FROM event_connect_accounts WHERE account_id=? LIMIT 1').bind(item.owner_account_id).first();
    if (!connected || Number(connected.livemode) !== (stripe.live ? 1 : 0)) return eventPaymentsJson({ ok: false, error: 'organizer_stripe_not_ready', message: 'The organizer has not finished connecting payments for this event yet.' }, 409);
    if (Number(connected.charges_enabled) !== 1 || Number(connected.payouts_enabled) !== 1) return eventPaymentsJson({ ok: false, error: 'organizer_stripe_not_ready', message: 'The organizer still needs to finish Stripe onboarding before payments can be accepted.' }, 409);
    const cents = Number(item.unit_price_cents);
    const total = cents * quantity;
    if (!Number.isSafeInteger(total) || total < 50) return eventPaymentsJson({ ok: false, error: 'invalid_total' }, 400);
    const reserve = await env.DB.prepare("UPDATE event_sale_items SET quantity_reserved=quantity_reserved+? WHERE id=? AND is_active=1 AND (quantity_total IS NULL OR quantity_total-COALESCE((SELECT SUM(o.quantity) FROM event_sale_orders o WHERE o.item_id=event_sale_items.id AND o.status NOT IN ('refunded','failed','expired','pending','processing')),0)-quantity_reserved>=?)").bind(quantity, itemId, quantity).run();
    if (!reserve.meta || reserve.meta.changes !== 1) return eventPaymentsJson({ ok: false, error: 'sold_out', message: 'There is not enough availability for that quantity. Please choose a smaller quantity.' }, 409);
    const user = await currentEventPaymentsAccount(request, env).catch(() => null);
    let orderId = 0;
    try {
      const inserted = await env.DB.prepare("INSERT INTO event_sale_orders (event_id,item_id,owner_account_id,buyer_account_id,connected_account_id,quantity,unit_price_cents,total_amount_cents,currency,status,reservation_released,reserved_until) VALUES (?,?,?,?,?,?,?,?,?,'pending',0,datetime('now','+40 minutes'))")
        .bind(item.event_id, itemId, item.owner_account_id, user?.id || null, connected.stripe_account_id, quantity, cents, total, 'usd').run();
      orderId = Number(inserted.meta?.last_row_id || 0);
      if (!orderId) throw new Error('event_order_create_failed');
    } catch (error) {
      await env.DB.prepare('UPDATE event_sale_items SET quantity_reserved=MAX(0,quantity_reserved-?) WHERE id=?').bind(quantity,itemId).run();
      throw error;
    }
    const origin = stripe.origin || new URL(request.url).origin;
    const expiresAt = Math.floor(Date.now() / 1000) + 35 * 60;
    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('payment_method_types[0]', 'card');
    params.set('expires_at', String(expiresAt));
    params.set('line_items[0][price_data][currency]', 'usd');
    params.set('line_items[0][price_data][unit_amount]', String(cents));
    params.set('line_items[0][price_data][product_data][name]', item.title);
    params.set('line_items[0][price_data][product_data][description]', String(item.event_title || 'PokePrizePool event') + (item.description ? ' — ' + String(item.description).slice(0, 400) : ''));
    params.set('line_items[0][quantity]', String(quantity));
    params.set('client_reference_id', String(orderId));
    params.set('customer_creation', 'always');
    params.set('billing_address_collection', 'auto');
    params.set('success_url', origin + '/event.html?id=' + encodeURIComponent(item.event_id) + '&purchase=success&session_id={CHECKOUT_SESSION_ID}');
    params.set('cancel_url', origin + '/event.html?id=' + encodeURIComponent(item.event_id) + '&purchase=cancelled&order_id=' + encodeURIComponent(orderId));
    params.set('metadata[ppp_purchase_type]', 'event_sale');
    params.set('metadata[ppp_event_sale_order_id]', String(orderId));
    params.set('metadata[ppp_event_id]', String(item.event_id));
    params.set('metadata[ppp_event_sale_item_id]', String(itemId));
    params.set('metadata[ppp_event_owner_account_id]', String(item.owner_account_id));
    params.set('metadata[ppp_quantity]', String(quantity));
    for (const [key,value] of Object.entries({
      ppp_purchase_type:'event_sale', ppp_event_sale_order_id:String(orderId), ppp_event_id:String(item.event_id),
      ppp_event_sale_item_id:String(itemId), ppp_event_owner_account_id:String(item.owner_account_id), ppp_quantity:String(quantity)
    })) params.set('payment_intent_data[metadata][' + key + ']', value);
    let session;
    try {
      const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + stripe.secretKey, 'Stripe-Account': connected.stripe_account_id, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': 'ppp-event-sale-order-' + orderId },
        body: params
      });
      session = await response.json().catch(() => ({}));
      if (!response.ok || !session.url || !session.id) {
        console.error('Organizer event checkout failed:', response.status, session.error?.type || 'unknown');
        throw new Error('stripe_checkout_failed');
      }
      await env.DB.prepare("UPDATE event_sale_orders SET stripe_checkout_session_id=?,reserved_until=datetime('now','+40 minutes'),updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(session.id,orderId).run();
      return eventPaymentsJson({ ok: true, url: session.url, order_id: orderId, expires_at: session.expires_at || expiresAt });
    } catch (error) {
      await env.DB.batch([
        env.DB.prepare('UPDATE event_sale_items SET quantity_reserved=MAX(0,quantity_reserved-?) WHERE id=?').bind(quantity,itemId),
        env.DB.prepare("UPDATE event_sale_orders SET status='failed',reservation_released=1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND reservation_released=0").bind(orderId)
      ]);
      throw error;
    }
  } catch (error) {
    console.error('Event ticket / booth checkout failed:', error);
    return eventPaymentsJson({ ok: false, error: 'event_checkout_failed', message: 'Secure checkout could not be started. Please try again.' }, 502);
  }
}
export async function onRequest() { return eventPaymentsJson({ ok: false, error: 'method_not_allowed' }, 405); }
