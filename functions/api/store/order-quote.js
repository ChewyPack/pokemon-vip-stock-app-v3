import { json, wrap, HttpError, readJson } from '../../_lib/store.js';
import { quoteStoreItems } from '../../_lib/store-order-pricing.js';

export const onRequestPost = wrap(async ({ request, env }) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'Use the PokePrizePool website to check your order total.');
  if (!env.DB) throw new HttpError(503, 'The store catalog is temporarily unavailable.');
  const data = await readJson(request, 25000);
  if (String(data.website || '').trim()) return json({ ok: true, request_received: true }, 202);
  const quote = await quoteStoreItems(env.DB, env, data.items, data.destinationState);
  return json({
    ok: true,
    state: quote.state,
    items: quote.lines.map(line => ({
      productId: line.productId,
      variantId: line.variantId,
      name: line.name,
      variantTitle: line.variantTitle,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: line.lineTotalCents,
      category: line.category,
      isPrintify: line.isPrintify
    })),
    subtotalCents: quote.subtotalCents,
    taxableCents: quote.taxableCents,
    taxRateBps: quote.taxRateBps,
    taxCents: quote.taxCents,
    totalCents: quote.totalCents,
    taxCollectionEnabled: quote.taxCollectionEnabled,
    taxLabel: quote.taxLabel,
    taxNotice: quote.taxNotice,
    fulfillment: quote.fulfillment
  });
});

export async function onRequest() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
