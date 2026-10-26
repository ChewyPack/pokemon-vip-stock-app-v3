import { json, wrap, requireAdmin, readJson, HttpError } from '../../../_lib/store.js';
import { submitPaidPrintifyOrder, sendPrintifyOrderToProduction } from '../../../_lib/printify-orders.js';

// POST /api/store/admin/printify-orders { action: "retry_submission"|"send_to_production", orderId }
export const onRequestPost = wrap(async (ctx) => {
  const actor = await requireAdmin(ctx);
  const body = await readJson(ctx.request, 5000);
  const orderId = Number(body.orderId);
  if (!Number.isInteger(orderId) || orderId < 1) throw new HttpError(400, 'Invalid store order ID');

  if (body.action === 'retry_submission') {
    const result = await submitPaidPrintifyOrder(ctx.env.DB, ctx.env, orderId);
    if (!result.applicable) throw new HttpError(409, 'This order has no eligible Printify items or is not paid yet.');
    await ctx.env.DB.prepare('INSERT INTO store_audit_log (actor, action, detail) VALUES (?,?,?)')
      .bind(actor, 'printify.retry_submission', JSON.stringify({ orderId, status: result.status || 'unknown' })).run();
    if (result.status === 'failed') return json({ ok: false, status: result.status, error: 'Printify submission failed. Review the order details and error, then retry.' }, 502);
    return json({ ok: true, status: result.status, printifyOrderId: result.orderId || null });
  }

  if (body.action === 'send_to_production') {
    try {
      const result = await sendPrintifyOrderToProduction(ctx.env.DB, ctx.env, orderId, actor);
      return json(result);
    } catch (error) {
      throw new HttpError(409, String(error?.message || 'Could not send the Printify order to production').slice(0, 250));
    }
  }

  throw new HttpError(400, 'Unsupported Printify order action');
});
