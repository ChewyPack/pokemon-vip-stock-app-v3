import { accountStripeConfig } from '../_lib/account-stripe.js';
import { currentEventPaymentsAccount, ensureEventPaymentsSchema, eventPaymentsJson, getOwnedEvent, eventItemAvailability, itemAvailability, cleanupExpiredEventReservations } from '../_lib/event-payments.js';

function clean(value, max = 500) { return String(value ?? '').trim().slice(0, max); }
function dollarsToCents(value) {
  if (value === '' || value == null) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : NaN;
}
async function accountConnectStatus(env, accountId) {
  const row = await env.DB.prepare('SELECT details_submitted,charges_enabled,payouts_enabled FROM event_connect_accounts WHERE account_id=? LIMIT 1').bind(accountId).first();
  return { connected: !!row && Number(row.charges_enabled) === 1 && Number(row.payouts_enabled) === 1, charges_enabled: !!row && Number(row.charges_enabled) === 1, payouts_enabled: !!row && Number(row.payouts_enabled) === 1 };
}
function shapeItem(item, manage) {
  const availability = itemAvailability(item);
  return {
    id: Number(item.id), event_id: Number(item.event_id), item_type: item.item_type,
    title: item.title, description: item.description || '', unit_price_cents: Number(item.unit_price_cents),
    quantity_total: item.quantity_total == null ? null : Number(item.quantity_total), is_active: Number(item.is_active) === 1,
    sold_count: availability.sold_count, reserved_count: availability.reserved_count,
    available_quantity: availability.available_quantity, created_at: item.created_at, updated_at: item.updated_at
  };
}
async function loadItems(env, eventId, manage) {
  const rows = await env.DB.prepare("SELECT i.*, COALESCE((SELECT SUM(o.quantity) FROM event_sale_orders o WHERE o.item_id=i.id AND o.status NOT IN ('refunded','failed','expired','pending','processing')),0) AS sold_count, i.quantity_reserved AS reserved_count FROM event_sale_items i WHERE i.event_id=? " + (manage ? '' : 'AND i.is_active=1 ') + "ORDER BY CASE i.item_type WHEN 'admission' THEN 0 WHEN 'booth' THEN 1 ELSE 2 END,i.id").bind(eventId).all();
  return (rows.results || []).map(item => shapeItem(item, manage));
}
async function eventOrders(env, eventId) {
  const result = await env.DB.prepare("SELECT o.id,o.item_id,o.quantity,o.unit_price_cents,o.total_amount_cents,o.amount_refunded_cents,o.stripe_fee_cents,o.net_amount_cents,o.stripe_balance_transaction_id,o.currency,o.status,o.dispute_status,o.buyer_email,o.buyer_name,o.created_at,o.updated_at,i.title AS item_title,i.item_type FROM event_sale_orders o JOIN event_sale_items i ON i.id=o.item_id WHERE o.event_id=? ORDER BY o.created_at DESC LIMIT 200").bind(eventId).all();
  return result.results || [];
}
export async function onRequestGet({ request, env }) {
  if (!env.DB) return eventPaymentsJson({ ok: false, error: 'database_not_configured' }, 500);
  try {
    await ensureEventPaymentsSchema(env);
    await cleanupExpiredEventReservations(env.DB);
    const url = new URL(request.url);
    if (url.searchParams.get('admin') === '1') {
      const user = await currentEventPaymentsAccount(request, env);
      if (!user) return eventPaymentsJson({ ok: false, error: 'login_required' }, 401);
      if (Number(user.is_admin || 0) !== 1) return eventPaymentsJson({ ok: false, error: 'admin_required' }, 403);
      const result = await env.DB.prepare("SELECT o.id,o.event_id,o.item_id,o.owner_account_id,o.connected_account_id,o.buyer_email,o.buyer_name,o.quantity,o.unit_price_cents,o.total_amount_cents,o.amount_refunded_cents,o.stripe_fee_cents,o.net_amount_cents,o.stripe_balance_transaction_id,o.currency,o.status,o.dispute_status,o.stripe_checkout_session_id,o.stripe_payment_intent_id,o.created_at,o.updated_at,e.title AS event_title,e.slug,e.event_date,i.title AS item_title,i.item_type,COALESCE(a.display_name,'Organizer') AS organizer_name,COALESCE(a.email,'') AS organizer_email FROM event_sale_orders o JOIN poke_report_events e ON e.id=o.event_id JOIN event_sale_items i ON i.id=o.item_id LEFT JOIN accounts a ON a.id=o.owner_account_id ORDER BY o.created_at DESC LIMIT 1000").all();
      const sales = result.results || [];
      const paidStatuses = new Set(['paid','partially_refunded','refunded','disputed','dispute_won','dispute_lost']);
      const summary = sales.reduce((out, sale) => {
        out.orders += 1;
        if (paidStatuses.has(sale.status)) out.gross_paid_cents += Number(sale.total_amount_cents || 0);
        out.refunded_cents += Number(sale.amount_refunded_cents || 0);
        out.stripe_fees_cents += Number(sale.stripe_fee_cents || 0);
        out.net_after_fees_cents += Number(sale.net_amount_cents || 0);
        if (sale.status === 'paid' || sale.status === 'partially_refunded') out.successful_orders += 1;
        if (['pending','processing'].includes(sale.status)) out.pending_orders += 1;
        if (['disputed','dispute_lost'].includes(sale.status)) out.disputed_orders += 1;
        return out;
      }, { orders: 0, successful_orders: 0, pending_orders: 0, disputed_orders: 0, gross_paid_cents: 0, refunded_cents: 0, stripe_fees_cents: 0, net_after_fees_cents: 0 });
      summary.net_after_refunds_cents = summary.net_after_fees_cents - summary.refunded_cents;
      const payouts = await env.DB.prepare("SELECT p.*,COALESCE(a.display_name,'Organizer') AS organizer_name,COALESCE(a.email,'') AS organizer_email FROM event_connect_payout_activity p LEFT JOIN accounts a ON a.id=p.owner_account_id ORDER BY p.created_at DESC LIMIT 300").all();
      const stripe = accountStripeConfig(env);
      const webhookSecret = stripe ? (stripe.live ? env.STRIPE_EVENT_CONNECT_WEBHOOK_SECRET : env.STRIPE_EVENT_CONNECT_TEST_WEBHOOK_SECRET) : '';
      return eventPaymentsJson({ ok: true, summary, sales, payouts: payouts.results || [], webhook_ready: !!webhookSecret });
    }
    const eventId = Number(url.searchParams.get('event_id') || 0);
    if (!Number.isSafeInteger(eventId) || eventId < 1) return eventPaymentsJson({ ok: false, error: 'valid_event_id_required' }, 400);
    const user = await currentEventPaymentsAccount(request, env);
    const event = await env.DB.prepare('SELECT id,title,event_date,status,owner_account_id FROM poke_report_events WHERE id=? LIMIT 1').bind(eventId).first();
    const manage = !!user && (Number(user.is_admin || 0) === 1 || Number(event?.owner_account_id || 0) === Number(user.id));
    if (!event || (event.status !== 'published' && !manage)) return eventPaymentsJson({ ok: false, error: 'event_not_found' }, 404);
    const items = await loadItems(env, eventId, manage);
    const stripe = accountStripeConfig(env);
    const webhookSecret = stripe ? (stripe.live ? env.STRIPE_EVENT_CONNECT_WEBHOOK_SECRET : env.STRIPE_EVENT_CONNECT_TEST_WEBHOOK_SECRET) : '';
    const webhookReady = !!webhookSecret;
    let orders = [];
    let connect = null;
    let summary = null;
    const connectOwnerId = Number(event.owner_account_id || (manage ? user.id : 0));
    const publicConnect = connectOwnerId ? await accountConnectStatus(env, connectOwnerId) : { connected: false };
    if (manage) {
      orders = await eventOrders(env, eventId);
      connect = await accountConnectStatus(env, Number(event.owner_account_id || user.id));
      summary = orders.reduce((out, sale) => {
        out.orders += 1;
        if (['paid','partially_refunded','refunded','disputed','dispute_won','dispute_lost'].includes(sale.status)) out.gross_paid_cents += Number(sale.total_amount_cents || 0);
        out.refunded_cents += Number(sale.amount_refunded_cents || 0);
        out.stripe_fees_cents += Number(sale.stripe_fee_cents || 0);
        out.net_after_fees_cents += Number(sale.net_amount_cents || 0);
        if (['pending','processing'].includes(sale.status)) out.pending_orders += 1;
        return out;
      }, { orders: 0, gross_paid_cents: 0, refunded_cents: 0, pending_orders: 0, stripe_fees_cents: 0, net_after_fees_cents: 0 });
      summary.net_after_refunds_cents = summary.net_after_fees_cents - summary.refunded_cents;
    } else {
      const connect = null;
    }
    return eventPaymentsJson({ ok: true, event: { id: event.id, title: event.title, event_date: event.event_date }, can_manage: manage, checkout_enabled: !!publicConnect.connected && webhookReady, checkout_disabled_reason: !webhookReady ? 'payment_tracking_setup_pending' : (!publicConnect.connected ? 'organizer_stripe_not_ready' : ''), webhook_ready: manage ? webhookReady : undefined, connect: manage ? connect : undefined, items, orders: manage ? orders : undefined, summary: manage ? summary : undefined });
  } catch (error) {
    console.error('Event sales read failed:', error);
    return eventPaymentsJson({ ok: false, error: 'event_sales_unavailable' }, 500);
  }
}
export async function onRequestPost({ request, env }) {
  if (!env.DB) return eventPaymentsJson({ ok: false, error: 'database_not_configured' }, 500);
  const user = await currentEventPaymentsAccount(request, env);
  if (!user) return eventPaymentsJson({ ok: false, error: 'login_required' }, 401);
  const origin = request.headers.get('Origin');
  if (origin) {
    try { if (new URL(origin).origin !== new URL(request.url).origin) return eventPaymentsJson({ ok: false, error: 'origin_not_allowed' }, 403); }
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
    const action = clean(data.action, 40);
    if (action === 'deactivate_item') {
      const itemId = Number(data.item_id || 0);
      if (!Number.isSafeInteger(itemId) || itemId < 1) return eventPaymentsJson({ ok: false, error: 'valid_item_id_required' }, 400);
      const result = await env.DB.prepare('UPDATE event_sale_items SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND event_id=? AND owner_account_id=?').bind(itemId, eventId, Number(event.owner_account_id || user.id)).run();
      if (!result.meta?.changes) return eventPaymentsJson({ ok: false, error: 'sale_item_not_found' }, 404);
      return eventPaymentsJson({ ok: true, items: await loadItems(env, eventId, true) });
    }
    if (action !== 'save_item') return eventPaymentsJson({ ok: false, error: 'unknown_action' }, 400);
    if (event.status !== 'published' && Number(user.is_admin || 0) !== 1) return eventPaymentsJson({ ok: false, error: 'event_not_published', message: 'Publish the event before creating sale items.' }, 409);
    const itemId = Number(data.id || 0);
    const type = clean(data.item_type, 20);
    const title = clean(data.title, 140);
    const description = clean(data.description, 1000);
    const cents = dollarsToCents(data.price);
    const quantityText = String(data.quantity_total ?? '').trim();
    const quantityTotal = quantityText === '' ? null : Number(quantityText);
    const isActive = data.is_active === false || data.is_active === 0 || data.is_active === '0' ? 0 : 1;
    if (!['admission','booth','table'].includes(type)) return eventPaymentsJson({ ok: false, error: 'invalid_item_type' }, 400);
    if (!title) return eventPaymentsJson({ ok: false, error: 'title_required' }, 400);
    if (!Number.isSafeInteger(cents) || cents < 50 || cents > 100000000) return eventPaymentsJson({ ok: false, error: 'invalid_price', message: 'Enter a price of at least $0.50.' }, 400);
    if (quantityTotal !== null && (!Number.isSafeInteger(quantityTotal) || quantityTotal < 1 || quantityTotal > 100000)) return eventPaymentsJson({ ok: false, error: 'invalid_quantity_total' }, 400);
    const ownerId = Number(event.owner_account_id || user.id);
    if (itemId) {
      const current = await env.DB.prepare('SELECT id,owner_account_id FROM event_sale_items WHERE id=? AND event_id=? LIMIT 1').bind(itemId, eventId).first();
      if (!current || Number(current.owner_account_id) !== ownerId) return eventPaymentsJson({ ok: false, error: 'sale_item_not_found' }, 404);
      const existing = await eventItemAvailability(env.DB, itemId);
      if (quantityTotal !== null && quantityTotal < Number(existing.sold_count || 0) + Number(existing.reserved_count || 0)) return eventPaymentsJson({ ok: false, error: 'quantity_below_committed', message: 'Quantity cannot be lower than tickets or spaces already sold or reserved.' }, 409);
      await env.DB.prepare('UPDATE event_sale_items SET item_type=?,title=?,description=?,unit_price_cents=?,quantity_total=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND event_id=? AND owner_account_id=?')
        .bind(type,title,description,cents,quantityTotal,isActive,itemId,eventId,ownerId).run();
    } else {
      await env.DB.prepare('INSERT INTO event_sale_items (event_id,owner_account_id,item_type,title,description,unit_price_cents,quantity_total,is_active) VALUES (?,?,?,?,?,?,?,?)')
        .bind(eventId,ownerId,type,title,description,cents,quantityTotal,isActive).run();
    }
    return eventPaymentsJson({ ok: true, items: await loadItems(env, eventId, true) });
  } catch (error) {
    console.error('Event sale item save failed:', error);
    return eventPaymentsJson({ ok: false, error: 'event_sale_save_failed' }, 500);
  }
}
export async function onRequest() { return eventPaymentsJson({ ok: false, error: 'method_not_allowed' }, 405); }
