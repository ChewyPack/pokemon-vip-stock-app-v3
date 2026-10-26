import { json, fail, verifyStripeSignature } from '../../_lib/store.js';
import { releaseOrder } from './checkout.js';
import { submitPaidPrintifyOrder } from '../../_lib/printify-orders.js';

// POST /api/store/webhook  — register this as its OWN Stripe endpoint with its OWN signing secret
// (STRIPE_STORE_WEBHOOK_SECRET). The membership webhook is untouched. Events without
// metadata.ppp_store_order_id are ignored, so the two systems cannot interfere.
export async function onRequestPost({ request, env }) {
  const raw = await request.text();
  const ok = await verifyStripeSignature(raw, request.headers.get('stripe-signature'), env.STRIPE_STORE_WEBHOOK_SECRET);
  if (!ok) return fail(400, 'Bad signature');
  const event = JSON.parse(raw);
  const db = env.DB;

  // Idempotency: only the first delivery of an event id gets processed.
  const ins = await db.prepare('INSERT OR IGNORE INTO store_stripe_events (id, type) VALUES (?, ?)').bind(event.id, event.type).run();
  if (!ins.meta.changes) return json({ received: true, duplicate: true });

  try {
    const s = event.data?.object || {};
    const orderId = Number(s.metadata?.ppp_store_order_id);
    if (s.object === 'checkout.session' && Number.isInteger(orderId)) {
      if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        if (s.payment_status === 'paid') {
          const result = await markPaid(db, orderId, s);
          if (result.paid) await submitPaidPrintifyOrder(db, env, orderId);
        }
      } else if (event.type === 'checkout.session.expired') {
        await releaseOrder(db, orderId, 'expired');
      } else if (event.type === 'checkout.session.async_payment_failed') {
        await releaseOrder(db, orderId, 'failed');
      }
    }
  } catch (e) {
    console.error('store webhook failed', e);
    await db.prepare('DELETE FROM store_stripe_events WHERE id = ?').bind(event.id).run(); // let Stripe retry
    return fail(500, 'Processing failed');
  }
  return json({ received: true });
}

async function markPaid(db, orderId, s) {
  const order = await db.prepare(
    'SELECT subtotal_cents, shipping_cents, tax_cents, payment_status, shipping_name, shipping_address FROM store_orders WHERE id = ?'
  ).bind(orderId).first();
  if (!order || order.payment_status === 'paid') return { paid: false };
  const ship = s.shipping_details || s.collected_information?.shipping_details || {};
  const tax = Number(order.tax_cents || 0) + Number(s.total_details?.amount_tax || 0);
  const stripeShipping = s.total_details?.amount_shipping || 0;
  // Printify shipping is shown as a fixed checkout line item after a server quote;
  // regular stocked orders continue using Stripe's built-in shipping options.
  const expectedSubtotal = Number(order.subtotal_cents || 0) + Number(order.tax_cents || 0) + (s.metadata?.ppp_printify_order === '1' ? Number(order.shipping_cents || 0) : 0);
  const status = s.amount_subtotal === expectedSubtotal && order.payment_status === 'pending'
    ? 'paid' : 'review';
  const shippingName = ship.name || order.shipping_name || null;
  const shippingAddress = ship.address ? JSON.stringify(ship.address) : (order.shipping_address || JSON.stringify({}));
  const shippingCents = stripeShipping > 0 ? stripeShipping : Number(order.shipping_cents || 0);
  await db.prepare(
    `UPDATE store_orders SET payment_status = ?, fulfillment_status = CASE WHEN ? = 'paid' THEN 'processing' ELSE fulfillment_status END,
       email = COALESCE(?, email), shipping_name = ?, shipping_address = ?, shipping_cents = ?, tax_cents = ?, total_cents = ?,
       stripe_payment_intent = ?, updated_at = datetime('now')
     WHERE id = ? AND payment_status IN ('pending','expired')`
  ).bind(status, status, s.customer_details?.email || null, shippingName, shippingAddress,
    shippingCents, tax, s.amount_total || 0, typeof s.payment_intent === 'string' ? s.payment_intent : null, orderId).run();
  return { paid: status === 'paid' };
}
