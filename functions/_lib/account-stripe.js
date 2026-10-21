// Shared Stripe configuration for the separate website-account membership system.
// Production is enabled only when STRIPE_ACCOUNT_MODE=live is explicitly set.
// Preview/staging stays on Stripe Test Mode by default.
const TEST_PRICES = {
  collector_plus: { monthly: 'price_1UQVNSGXWs1THDBR6RhAZ3dI', yearly: 'price_1UQVNSGXWs1THDBRvoZUm24d' },
  vendor: { monthly: 'price_1UQVOUGXWs1THDBRYzlRnDDy', yearly: 'price_1UQVOUGXWs1THDBRsL4w405C' },
  organizer: { monthly: 'price_1UQVQLGXWs1THDBR39ZABaOC', yearly: 'price_1UQVQLGXWs1THDBRe7oCo2FN' }
};
function livePrices(env) {
  return {
    collector_plus: { monthly: 'price_1UNaOcK5IxhaGczAyrX7Znyy', yearly: 'price_1UNaOcK5IxhaGczAzg3OAdDb' },
    vendor: { monthly: 'price_1USIkQK5IxhaGczAsZPCANsv', yearly: 'price_1USIkQK5IxhaGczAwFLhU5tS' },
    organizer: {
      monthly: typeof env.STRIPE_ACCOUNT_ORGANIZER_MONTHLY_PRICE_ID === 'string' ? env.STRIPE_ACCOUNT_ORGANIZER_MONTHLY_PRICE_ID.trim() : '',
      yearly: typeof env.STRIPE_ACCOUNT_ORGANIZER_YEARLY_PRICE_ID === 'string' ? env.STRIPE_ACCOUNT_ORGANIZER_YEARLY_PRICE_ID.trim() : ''
    }
  };
}
export function accountStripeConfig(env) {
  const live = env.STRIPE_ACCOUNT_MODE === 'live';
  const secretKey = live ? env.STRIPE_SECRET_KEY : env.STRIPE_TEST_SECRET_KEY;
  const validKey = live
    ? typeof secretKey === 'string' && secretKey.startsWith('sk_live_')
    : typeof secretKey === 'string' && secretKey.startsWith('sk_test_');
  if (!validKey) return null;
  const prices = live ? livePrices(env) : TEST_PRICES;
  const priceTiers = {};
  for (const [tier, intervals] of Object.entries(prices)) {
    for (const priceId of Object.values(intervals)) {
      if (typeof priceId === 'string' && priceId.length > 0) priceTiers[priceId] = tier;
    }
  }
  return {
    live, secretKey, prices, priceTiers,
    source: live ? 'stripe_live' : 'stripe_test',
    webhookSecret: live ? env.STRIPE_ACCOUNT_WEBHOOK_SECRET : env.STRIPE_ACCOUNT_TEST_WEBHOOK_SECRET,
    origin: live ? 'https://pokeprizepool.com' : ''
  };
}
export function accountStripeConfigError(env) {
  return env.STRIPE_ACCOUNT_MODE === 'live' ? 'stripe_live_key_not_configured' : 'stripe_test_key_not_configured';
}
export function priceDetailsFor(prices) {
  return Object.fromEntries(Object.entries(prices).flatMap(([tier, intervals]) =>
    Object.entries(intervals)
      .filter(([, priceId]) => typeof priceId === 'string' && priceId.length > 0)
      .map(([interval, priceId]) => [priceId, { tier, interval }])
  ));
}
