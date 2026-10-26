import { PRINTIFY_SHOP_ID, printifyRequest, printifyCommerceReady } from './printify.js';

const shortError = (error) => String(error?.message || 'Printify request failed').slice(0, 500);

async function findExistingOrder(env, shopId, externalId) {
  // Printify exposes an API-created order's external_id as metadata.shop_order_id.
  // Search recent pages before retrying a POST, so a lost response cannot create a duplicate.
  let lastPage = 50;
  for (let page = 1; page <= Math.min(50, lastPage); page++) {
    const result = await printifyRequest(env, `shops/${shopId}/orders.json?page=${page}`);
    const data = Array.isArray(result?.data) ? result.data : Array.isArray(result) ? result : [];
    const found = data.find((item) =>
      String(item.external_id || '') === externalId ||
      String(item.label || '') === externalId ||
      String(item.metadata?.shop_order_id || '') === externalId ||
      String(item.metadata?.shop_order_label || '') === externalId
    );
    if (found) return found;
    const reported = Number(result?.last_page || 0);
    if (reported > 0) lastPage = Math.min(50, reported);
    else if (data.length < 10) break;
    if (!data.length || page >= lastPage) break;
  }
  return null;
}

// Create the paid order in Printify, but do not send it to production here.
// This function is safe to retry: it searches for the deterministic external order ID first.
export async function submitPaidPrintifyOrder(db, env, orderId) {
  const itemColumns = await db.prepare('PRAGMA table_info(store_order_items)').all();
  if (!(itemColumns.results || []).some((column) => column.name === 'printify_product_id')) return { applicable: false };

  const order = await db.prepare(
    'SELECT id, order_number, payment_status, shipping_address, printify_status, printify_order_id FROM store_orders WHERE id = ?'
  ).bind(orderId).first();
  if (!order || order.payment_status !== 'paid') return { applicable: false };
  const items = (await db.prepare(
    'SELECT id, printify_shop_id, printify_product_id, printify_variant_id, quantity FROM store_order_items WHERE order_id = ? AND printify_product_id IS NOT NULL'
  ).bind(orderId).all()).results || [];
  if (!items.length) return { applicable: false };
  const shopIds = [...new Set(items.map((item) => String(item.printify_shop_id || '')))];
  if (shopIds.length !== 1 || shopIds[0] !== PRINTIFY_SHOP_ID) {
    await db.prepare(
      "UPDATE store_orders SET printify_status = 'failed', printify_error = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind('Printify order items do not all belong to the selected PokePrizePool shop.', orderId).run();
    return { applicable: true, status: 'failed' };
  }

  if (order.printify_order_id) return { applicable: true, status: order.printify_status, orderId: order.printify_order_id };
  if (!printifyCommerceReady(env)) {
    await db.prepare(
      "UPDATE store_orders SET printify_status = 'awaiting_setup', printify_error = ?, updated_at = datetime('now') WHERE id = ? AND payment_status = 'paid'"
    ).bind('Printify order creation is paused. Verify Printify shop Order approval is Manual, then enable PRINTIFY_LIVE_CHECKOUT_ENABLED, PRINTIFY_ORDER_SUBMISSION_ENABLED, and PRINTIFY_MANUAL_APPROVAL_CONFIRMED in the production Pages environment.', orderId).run();
    return { applicable: true, status: 'awaiting_setup' };
  }

  // Claim a single attempt. The admin retry path uses the same status guard.
  const claim = await db.prepare(
    `UPDATE store_orders SET printify_status = 'submitting', printify_error = NULL,
       printify_last_attempt_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ? AND payment_status = 'paid' AND printify_order_id IS NULL
       AND printify_status IN ('not_applicable','awaiting_setup','failed','pending')`
  ).bind(orderId).run();
  if (!claim.meta.changes) return { applicable: true, status: order.printify_status };

  try {
    const externalId = String(order.order_number);
    let remote = await findExistingOrder(env, PRINTIFY_SHOP_ID, externalId);
    if (!remote) {
      let addressTo = {};
      try { addressTo = JSON.parse(order.shipping_address || '{}'); } catch { addressTo = {}; }
      if (!addressTo.first_name || !addressTo.last_name || !addressTo.address1 || !addressTo.city || !addressTo.zip || !addressTo.country) {
        throw new Error('The saved shipping address is incomplete. Review the order before retrying Printify submission.');
      }
      remote = await printifyRequest(env, `shops/${PRINTIFY_SHOP_ID}/orders.json`, {
        method: 'POST',
        body: {
          external_id: externalId,
          label: externalId,
          line_items: items.map((item) => ({
            product_id: String(item.printify_product_id),
            variant_id: Number(item.printify_variant_id),
            quantity: Number(item.quantity),
            external_id: `${externalId}-${item.id}`,
          })),
          shipping_method: 1,
          is_printify_express: false,
          is_economy_shipping: false,
          send_shipping_notification: false,
          address_to: addressTo,
        },
      });
    }
    if (!remote?.id) throw new Error('Printify did not return an order ID.');
    const status = String(remote.status || 'on-hold').slice(0, 80);
    await db.prepare(
      `UPDATE store_orders SET printify_order_id = ?, printify_status = ?, printify_error = NULL,
        printify_submitted_at = COALESCE(printify_submitted_at, datetime('now')), updated_at = datetime('now')
       WHERE id = ? AND payment_status = 'paid'`
    ).bind(String(remote.id), status, orderId).run();
    return { applicable: true, status, orderId: String(remote.id) };
  } catch (error) {
    console.error('Printify order creation failed', orderId, error);
    await db.prepare(
      "UPDATE store_orders SET printify_status = 'failed', printify_error = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(shortError(error), orderId).run();
    return { applicable: true, status: 'failed' };
  }
}

export async function sendPrintifyOrderToProduction(db, env, orderId) {
  const order = await db.prepare(
    'SELECT id, order_number, payment_status, printify_order_id, printify_status FROM store_orders WHERE id = ?'
  ).bind(orderId).first();
  if (!order) throw new Error('Store order was not found.');
  if (order.payment_status !== 'paid') throw new Error('Only paid store orders may be sent to Printify.');
  if (!order.printify_order_id) throw new Error('Create the Printify order before sending it to production.');
  if (!['on-hold', 'pending', 'payment-not-received', 'has-issues'].includes(String(order.printify_status))) {
    throw new Error('This Printify order is not in a send-to-production state.');
  }
  const result = await printifyRequest(env, `shops/${PRINTIFY_SHOP_ID}/orders/${encodeURIComponent(order.printify_order_id)}/send_to_production.json`, { method: 'POST' });
  const status = String(result?.status || 'sent-to-production').slice(0, 80);
  await db.batch([
    db.prepare(
      'UPDATE store_orders SET printify_status = ?, printify_error = NULL, updated_at = datetime(\'now\') WHERE id = ?'
    ).bind(status, orderId),
    db.prepare('INSERT INTO store_audit_log (actor, action, detail) VALUES (?,?,?)')
      .bind('printify-admin', 'printify.send_to_production', JSON.stringify({ orderId, orderNumber: order.order_number, printifyOrderId: order.printify_order_id, status })),
  ]);
  return { ok: true, status, printifyOrderId: order.printify_order_id };
}
