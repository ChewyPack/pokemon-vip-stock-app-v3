import { json, fail, wrap } from './_lib.js';

// GET /api/store/order?n=PPP-XXXXXX&t=<public token>  — confirmation page data.
// Status comes from the database (set by the verified webhook), never from the success URL.
export const onRequestGet = wrap(async ({ request, env }) => {
  const u = new URL(request.url);
  const o = await env.DB.prepare('SELECT * FROM store_orders WHERE order_number = ? AND public_token = ?')
    .bind(u.searchParams.get('n') || '', u.searchParams.get('t') || '').first();
  if (!o) return fail(404, 'Order not found');
  const { results } = await env.DB.prepare('SELECT name, sku, unit_price_cents, quantity, line_total_cents FROM store_order_items WHERE order_id = ?').bind(o.id).all();
  return json({
    orderNumber: o.order_number, paymentStatus: o.payment_status, fulfillmentStatus: o.fulfillment_status,
    subtotalCents: o.subtotal_cents, shippingCents: o.shipping_cents, taxCents: o.tax_cents, totalCents: o.total_cents,
    tracking: o.tracking_number ? { carrier: o.tracking_carrier, number: o.tracking_number } : null,
    items: results, createdAt: o.created_at,
  });
});
