import { json, wrap, readJson, HttpError } from '../../_lib/store.js';
import { PRINTIFY_SHOP_ID, normalizePrintifyAddress, parseVariants, quotePrintifyShipping } from '../../_lib/printify.js';

// POST /api/store/shipping-quote { items, email, shippingAddress }
// Shipping is quoted server-side against the selected variant IDs and entered address.
export const onRequestPost = wrap(async ({ request, env }) => {
  const body = await readJson(request, 20000);
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 25) {
    throw new HttpError(400, 'Your cart is empty or too large.');
  }
  const wanted = new Map();
  for (const item of body.items) {
    const productId = Number(item?.productId);
    const variantId = Number(item?.variantId);
    const quantity = Number(item?.quantity);
    if (!Number.isInteger(productId) || productId < 1 || !Number.isInteger(variantId) || variantId < 1 ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new HttpError(400, 'Choose a valid size/color for each Printify item.');
    }
    const key = productId + ':' + variantId;
    const combined = (wanted.get(key)?.quantity || 0) + quantity;
    if (combined > 20) throw new HttpError(400, 'You can order up to 20 of each variant per checkout.');
    wanted.set(key, { productId, variantId, quantity: combined });
  }

  const ids = [...new Set([...wanted.values()].map((x) => x.productId))];
  const rows = (await env.DB.prepare(`SELECT * FROM store_products WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results || [];
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  const lineItems = [];
  for (const item of wanted.values()) {
    const product = byId.get(item.productId);
    if (!product || !product.active || product.coming_soon) throw new HttpError(409, 'A Printify item in your cart is no longer available.');
    if (String(product.printify_shop_id || '') !== PRINTIFY_SHOP_ID || !product.printify_product_id) {
      throw new HttpError(400, 'Printify shipping quotes can only be calculated for PokePrizePool merchandise.');
    }
    const variant = parseVariants(product.printify_variants).find((v) => Number(v.id) === item.variantId);
    if (!variant || variant.enabled === false || variant.isAvailable === false) {
      throw new HttpError(409, 'A selected size/color is no longer available. Update your cart and try again.');
    }
    lineItems.push({
      product_id: String(product.printify_product_id),
      variant_id: item.variantId,
      quantity: item.quantity,
      external_id: `quote-${product.id}-${item.variantId}`,
    });
  }

  const email = typeof body.email === 'string' ? body.email.trim().slice(0, 200) : '';
  const addressTo = normalizePrintifyAddress(body.shippingAddress, email, env.STORE_SHIP_COUNTRIES || 'US');
  const quote = await quotePrintifyShipping(env, lineItems, addressTo);
  return json({
    ok: true,
    shippingCents: quote.shippingCents,
    shippingMethod: quote.shippingMethod,
    methodName: quote.methodName,
    currency: 'USD',
    addressCountry: addressTo.country,
    itemCount: lineItems.reduce((sum, line) => sum + line.quantity, 0),
  });
});
