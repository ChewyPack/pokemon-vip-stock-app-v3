import { HttpError } from './store.js';
import { isBlockedPrintifyProductTitle, parseVariants } from './printify.js';

const PAYMENT_TAX_RATE_BPS = 700;
const manualMode = (env) => String(env.STORE_PAYMENT_MODE || 'manual').trim().toLowerCase() === 'manual';
const taxEnabled = (env) => String(env.STORE_RI_SALES_TAX_ENABLED || '').trim().toLowerCase() === 'true';
const dollarsToCents = (value) => Number.isSafeInteger(value) && value >= 0;
const clothingPattern = /\b(t-?shirts?|tees?|hoodies?|sweatshirts?|sweaters?|shirts?|beanies?|hats?|caps?|jackets?|coats?|pants|shorts|socks|leggings|dresses|skirts|uniforms?|scarves?|footwear|shoes?)\b/i;
const clean = (value, max = 150) => String(value ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);

function isClearlyExemptClothing(product) {
  const category = String(product.category || '').toLowerCase();
  if (category !== 'merch') return false;
  return clothingPattern.test(String(product.name || '') + ' ' + String(product.product_type || ''));
}

export async function quoteStoreItems(db, env, rawItems, destinationState = 'RI') {
  if (!Array.isArray(rawItems) || !rawItems.length || rawItems.length > 25) {
    throw new HttpError(400, 'Your cart is empty or has too many different items.');
  }
  const state = destinationState === 'OUTSIDE_RI' ? 'OUTSIDE_RI' : 'RI';
  const wanted = new Map();
  for (const item of rawItems) {
    const productId = Number(item?.productId);
    const variantId = item?.variantId == null || item.variantId === '' ? null : Number(item.variantId);
    const quantity = Number(item?.quantity);
    if (!Number.isSafeInteger(productId) || productId < 1 ||
        (variantId !== null && (!Number.isSafeInteger(variantId) || variantId < 1)) ||
        !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new HttpError(400, 'One of the cart items has invalid details.');
    }
    const key = productId + ':' + (variantId == null ? '' : variantId);
    const combined = (wanted.get(key)?.quantity || 0) + quantity;
    if (combined > 20) throw new HttpError(400, 'You can request up to 20 of each item.');
    wanted.set(key, { productId, variantId, quantity: combined });
  }

  const ids = [...new Set([...wanted.values()].map((item) => item.productId))];
  const result = await db.prepare('SELECT * FROM store_products WHERE id IN (' + ids.map(() => '?').join(',') + ')').bind(...ids).all();
  const byId = new Map((result.results || []).map((row) => [Number(row.id), row]));
  const lines = [];
  let subtotalCents = 0, taxableCents = 0;

  for (const item of wanted.values()) {
    const product = byId.get(item.productId);
    if (!product || Number(product.active) !== 1 || isBlockedPrintifyProductTitle(product.name)) {
      throw new HttpError(409, 'An item is no longer available. Refresh the store and try again.');
    }
    if (Number(product.coming_soon) === 1 && !manualMode(env)) {
      throw new HttpError(409, 'A product in your cart is coming soon and cannot be ordered yet.');
    }

    // A former Printify row that has been reused for a card/single is not made-to-order merchandise.
    const isPrintify = String(product.category || '').toLowerCase() === 'merch' && Boolean(product.printify_shop_id && product.printify_product_id);
    let unitPriceCents, variantTitle = '';
    if (isPrintify) {
      if (item.variantId === null) throw new HttpError(400, 'Choose a size/color for each apparel item before sending your request.');
      const variant = parseVariants(product.printify_variants).find((v) =>
        Number(v.id) === item.variantId && v.enabled !== false && v.isAvailable !== false &&
        Number.isSafeInteger(Number(v.priceCents)) && Number(v.priceCents) >= 0
      );
      if (!variant) throw new HttpError(409, 'A selected size or color is no longer available. Update your cart and try again.');
      unitPriceCents = Number(variant.priceCents);
      variantTitle = clean(variant.title || 'Selected option', 100);
    } else {
      // Manual order requests do not reserve inventory; availability is confirmed by PokePrizePool before fulfillment.
      if (!manualMode(env) && Number(product.inventory) < item.quantity) throw new HttpError(409, 'Not enough listed stock for "' + clean(product.name, 100) + '". Refresh the store and adjust your cart.');
      unitPriceCents = Number(product.price_cents);
      if (!dollarsToCents(unitPriceCents)) throw new HttpError(409, 'A product price needs review before an order can be requested.');
    }

    const lineTotalCents = unitPriceCents * item.quantity;
    if (!Number.isSafeInteger(lineTotalCents)) throw new HttpError(400, 'The cart total is too large.');
    subtotalCents += lineTotalCents;

    if (state === 'RI') {
      if (isClearlyExemptClothing(product)) {
        taxableCents += Math.max(0, unitPriceCents - 25000) * item.quantity;
      } else {
        taxableCents += lineTotalCents;
      }
    }
    lines.push({
      productId: item.productId,
      variantId: isPrintify ? item.variantId : null,
      name: clean(product.name, 150),
      variantTitle,
      quantity: item.quantity,
      unitPriceCents,
      lineTotalCents,
      category: clean(product.category, 50),
      isPrintify
    });
  }

  const taxCents = state === 'RI' ? Math.round(taxableCents * PAYMENT_TAX_RATE_BPS / 10000) : 0;
  const enabled = taxEnabled(env);
  const totalCents = subtotalCents + taxCents;
  const hasApparel = lines.some((line) => line.isPrintify || line.category.toLowerCase() === 'merch');
  const hasPickup = lines.some((line) => !line.isPrintify && line.category.toLowerCase() !== 'merch');
  const fulfillment = hasApparel && hasPickup
    ? 'Mixed cart — confirm apparel shipping and item pickup separately'
    : hasApparel ? 'Clothing/apparel shipping requested'
      : 'Pickup requested';

  return {
    state,
    lines,
    subtotalCents,
    taxableCents: state === 'RI' ? taxableCents : 0,
    taxRateBps: state === 'RI' ? PAYMENT_TAX_RATE_BPS : 0,
    taxCents,
    totalCents,
    taxCollectionEnabled: enabled,
    taxLabel: state !== 'RI' ? 'Rhode Island sales tax (not applicable to selected out-of-state destination)' : enabled ? 'Rhode Island sales tax' : 'Estimated Rhode Island sales tax',
    taxNotice: state !== 'RI'
      ? 'Rhode Island sales tax is not calculated for an out-of-state delivery. Other states’ tax is not calculated by this checkout.'
      : enabled
        ? 'Rhode Island sales tax is enabled for this store. Shipping charges, when applicable, must be confirmed separately.'
        : 'This is a tax estimate only. Do not represent or collect it as sales tax until PokePrizePool’s Rhode Island retail sales permit is active and STORE_RI_SALES_TAX_ENABLED is turned on.',
    fulfillment
  };
}
