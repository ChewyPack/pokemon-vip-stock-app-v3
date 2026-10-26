import { json, wrap, readJson, HttpError, stripe, randomId, orderNumber, assertStoreStripeMode } from '../../_lib/store.js';
import { PRINTIFY_SHOP_ID, normalizePrintifyAddress, parseVariants, quotePrintifyShipping, printifyCommerceReady } from '../../_lib/printify.js';

// POST /api/store/checkout body: { items:[{productId,variantId?,quantity}], email?, shippingAddress?, quotedShippingCents? }
// All prices and variants are validated against D1. Printify item shipping is re-quoted server-side.
export const onRequestPost = wrap(async ({ request, env }) => {
  assertStoreStripeMode(env);
  const origin = new URL(request.url).origin;
  const body = await readJson(request, 25000);
  const raw = Array.isArray(body.items) ? body.items : [];
  if (!raw.length || raw.length > 25) throw new HttpError(400, 'Cart is empty or too large');

  const wanted = new Map();
  for (const item of raw) {
    const productId = Number(item?.productId);
    const variantId = item?.variantId == null || item.variantId === '' ? null : Number(item.variantId);
    const quantity = Number(item?.quantity);
    if (!Number.isInteger(productId) || productId < 1 ||
        (variantId !== null && (!Number.isInteger(variantId) || variantId < 1)) ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new HttpError(400, 'Invalid cart item');
    }
    const key = `${productId}:${variantId == null ? '' : variantId}`;
    const combined = (wanted.get(key)?.quantity || 0) + quantity;
    if (combined > 20) throw new HttpError(400, 'Invalid cart item quantity');
    wanted.set(key, { productId, variantId, quantity: combined });
  }

  const ids = [...new Set([...wanted.values()].map((item) => item.productId))];
  const { results: rows } = await env.DB.prepare(
    `SELECT * FROM store_products WHERE id IN (${ids.map(() => '?').join(',')})`
  ).bind(...ids).all();
  const byId = new Map(rows.map((row) => [Number(row.id), row]));

  const email = typeof body.email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email.trim())
    ? body.email.trim().slice(0, 200) : null;
  let productSubtotal = 0;
  const lines = [];
  for (const item of wanted.values()) {
    const product = byId.get(item.productId);
    if (!product || !product.active) throw new HttpError(409, 'An item in your cart is no longer available');
    if (product.coming_soon) throw new HttpError(409, 'This product is coming soon and cannot be purchased yet');

    if (product.printify_product_id) {
      if (!printifyCommerceReady(env)) throw new HttpError(503, 'PokePrizePool Printify checkout is paused until the live checkout, Printify order submission, and Manual approval safeguards are confirmed.');
      if (String(product.printify_shop_id || '') !== PRINTIFY_SHOP_ID) throw new HttpError(409, 'This Printify product is not connected to the selected shop.');
      if (item.variantId == null) throw new HttpError(400, 'Choose a size/color for each Printify product.');
      const variant = parseVariants(product.printify_variants).find((v) => Number(v.id) === item.variantId);
      if (!variant || variant.enabled === false || variant.isAvailable === false ||
          !Number.isInteger(Number(variant.priceCents)) || Number(variant.priceCents) < 0) {
        throw new HttpError(409, 'A selected size/color is no longer available. Please update your cart.');
      }
      const unitPrice = Number(variant.priceCents);
      lines.push({
        product, quantity: item.quantity, isPrintify: true, variant,
        unitPrice, lineTotal: unitPrice * item.quantity,
        itemName: product.name + ' — ' + String(variant.title || 'Selected option').slice(0, 160),
        itemSku: String(variant.sku || product.sku || '').slice(0, 100),
      });
      productSubtotal += unitPrice * item.quantity;
    } else {
      if (item.variantId != null) throw new HttpError(400, 'The selected variant is not valid for this product.');
      if (Number(product.inventory) < item.quantity) throw new HttpError(409, `Only ${product.inventory} of "${product.name}" available`);
      const unitPrice = Number(product.price_cents);
      lines.push({
        product, quantity: item.quantity, isPrintify: false,
        unitPrice, lineTotal: unitPrice * item.quantity,
        itemName: product.name, itemSku: product.sku,
      });
      productSubtotal += unitPrice * item.quantity;
    }
  }

  const hasPrintify = lines.some((line) => line.isPrintify);
  if (hasPrintify && lines.some((line) => !line.isPrintify)) {
    throw new HttpError(400, 'For accurate shipping, place Printify merchandise in a separate order from other store products.');
  }

  const autoTax = env.STORE_TAX_MODE === 'stripe_automatic';
  if (!autoTax && env.STORE_TAX_MODE !== 'none_confirmed') throw new HttpError(503, 'Tax is not configured');

  let shippingCents = 0, addressTo = null, shippingOptions = [];
  if (hasPrintify) {
    if (!email) throw new HttpError(400, 'Enter an email address for your order receipt and shipping confirmation.');
    addressTo = normalizePrintifyAddress(body.shippingAddress, email, env.STORE_SHIP_COUNTRIES || 'US');
    const quoteLines = lines.map((line) => ({
      product_id: String(line.product.printify_product_id),
      variant_id: Number(line.variant.id),
      quantity: line.quantity,
      external_id: `quote-${line.product.id}-${line.variant.id}`,
    }));
    const quote = await quotePrintifyShipping(env, quoteLines, addressTo);
    shippingCents = quote.shippingCents;
    const quoted = Number(body.quotedShippingCents);
    if (!Number.isInteger(quoted) || quoted !== shippingCents) {
      return json({
        error: 'Printify standard shipping was updated. Review the new shipping estimate and continue again.',
        quoteChanged: true,
        shippingCents,
        shippingMethod: quote.shippingMethod,
        methodName: quote.methodName,
      }, 409);
    }
  } else {
    try { shippingOptions = JSON.parse(env.STORE_SHIPPING_OPTIONS || '[]'); } catch { shippingOptions = []; }
    if (!Array.isArray(shippingOptions) || !shippingOptions.length || shippingOptions.length > 10 ||
        shippingOptions.some((o) => !o || typeof o.name !== 'string' || !o.name.trim() || o.name.length > 80 ||
          !Number.isInteger(Number(o.amountCents)) || Number(o.amountCents) < 0 || Number(o.amountCents) > 100000)) {
      throw new HttpError(503, 'Shipping is not configured');
    }
  }

  const num = orderNumber(), token = randomId(16), db = env.DB;
  const totalBeforeTax = productSubtotal + shippingCents;
  const stmts = [db.prepare(
    `INSERT INTO store_orders (order_number, public_token, email, subtotal_cents, shipping_cents, total_cents, shipping_name, shipping_address)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(num, token, email, productSubtotal, shippingCents, totalBeforeTax,
    addressTo ? [addressTo.first_name, addressTo.last_name].join(' ') : null,
    addressTo ? JSON.stringify({ ...addressTo }) : null)];

  for (const line of lines) {
    if (line.isPrintify) {
      stmts.push(db.prepare(
        `INSERT INTO store_order_items (order_id, product_id, name, sku, unit_price_cents, quantity, line_total_cents,
          printify_shop_id, printify_product_id, printify_variant_id, printify_variant_title)
         VALUES ((SELECT id FROM store_orders WHERE order_number = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(num, line.product.id, line.itemName, line.itemSku, line.unitPrice, line.quantity, line.lineTotal,
        PRINTIFY_SHOP_ID, line.product.printify_product_id, Number(line.variant.id), String(line.variant.title || '').slice(0, 160)));
    } else {
      stmts.push(db.prepare(
        `INSERT INTO store_order_items (order_id, product_id, name, sku, unit_price_cents, quantity, line_total_cents)
         VALUES ((SELECT id FROM store_orders WHERE order_number = ?), ?, ?, ?, ?, ?, ?)`
      ).bind(num, line.product.id, line.itemName, line.itemSku, line.unitPrice, line.quantity, line.lineTotal));
      stmts.push(db.prepare(
        `UPDATE store_products SET inventory = inventory - ?, updated_at = datetime('now') WHERE id = ? AND active = 1`
      ).bind(line.quantity, line.product.id));
    }
  }

  try { await db.batch(stmts); }
  catch (e) { console.error('store order reservation failed', e); throw new HttpError(409, 'Sorry, an item just sold out. Please review your cart.'); }

  const order = await db.prepare('SELECT id FROM store_orders WHERE order_number = ?').bind(num).first();
  try {
    const stripeItems = lines.map((line) => ({
      quantity: line.quantity,
      price_data: {
        currency: 'usd',
        unit_amount: line.unitPrice,
        product_data: {
          name: line.itemName,
          ...(autoTax ? { tax_code: env.STORE_TAX_CODE || 'txcd_99999999' } : {}),
        },
        ...(autoTax ? { tax_behavior: 'exclusive' } : {}),
      },
    }));
    // For Printify orders the address has already been entered and quoted on PokePrizePool.
    // The shipping quote is a checkout line item so Stripe cannot silently re-price a different address.
    if (hasPrintify && shippingCents > 0) {
      stripeItems.push({
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: shippingCents,
          product_data: {
            name: 'Standard shipping (Printify)',
            ...(autoTax ? { tax_code: env.STORE_SHIPPING_TAX_CODE || 'txcd_92010001' } : {}),
          },
          ...(autoTax ? { tax_behavior: 'exclusive' } : {}),
        },
      });
    }

    const session = await stripe(env, 'checkout/sessions', {
      mode: 'payment', // one-time payment only. Never 'subscription'.
      client_reference_id: num,
      customer_email: email || undefined,
      success_url: `${origin}/store/order.html?n=${encodeURIComponent(num)}&t=${encodeURIComponent(token)}`,
      cancel_url: `${origin}/store.html?checkout=cancelled`,
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      metadata: { ppp_store_order_id: String(order.id), ppp_order_number: num, ppp_printify_order: hasPrintify ? '1' : '0' },
      payment_intent_data: { metadata: { ppp_store_order_id: String(order.id) } },
      ...(hasPrintify ? {} : { shipping_address_collection: { allowed_countries: (env.STORE_SHIP_COUNTRIES || 'US').split(',') } }),
      billing_address_collection: 'required',
      automatic_tax: autoTax ? { enabled: true } : undefined,
      line_items: stripeItems,
      ...(hasPrintify ? {} : {
        shipping_options: shippingOptions.map((option) => ({
          shipping_rate_data: {
            type: 'fixed_amount', display_name: String(option.name),
            fixed_amount: { amount: Number(option.amountCents), currency: 'usd' },
            ...(autoTax ? { tax_behavior: 'exclusive', tax_code: env.STORE_SHIPPING_TAX_CODE || 'txcd_92010001' } : {}),
          },
        })),
      }),
    });
    await db.prepare('UPDATE store_orders SET stripe_session_id = ? WHERE id = ?').bind(session.id, order.id).run();
    return json({ url: session.url, orderNumber: num, shippingCents });
  } catch (e) {
    await releaseOrder(db, order.id, 'failed');
    throw e;
  }
});

// Mark a still-pending order closed and return regular stocked inventory, exactly once.
export async function releaseOrder(db, orderId, status) {
  const columns = await db.prepare('PRAGMA table_info(store_products)').all();
  const hasPrintify = (columns.results || []).some((column) => column.name === 'printify_product_id');
  const regularOnly = hasPrintify ? 'AND printify_product_id IS NULL' : '';
  await db.batch([
    db.prepare(`UPDATE store_orders SET payment_status = ?, updated_at = datetime('now') WHERE id = ? AND payment_status = 'pending'`).bind(status, orderId),
    db.prepare(
      `UPDATE store_products SET inventory = inventory + COALESCE((SELECT SUM(quantity) FROM store_order_items WHERE order_id = ?1 AND product_id = store_products.id), 0)
       WHERE id IN (SELECT product_id FROM store_order_items WHERE order_id = ?1)
       ${regularOnly}
       AND EXISTS (SELECT 1 FROM store_orders WHERE id = ?1 AND payment_status = ?2 AND restocked = 0)`
    ).bind(orderId, status),
    db.prepare(`UPDATE store_orders SET restocked = 1 WHERE id = ? AND payment_status = ? AND restocked = 0`).bind(orderId, status),
  ]);
}
