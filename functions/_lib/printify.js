import { HttpError } from './store.js';

export const PRINTIFY_API = 'https://api.printify.com/v1/';
export const PRINTIFY_SHOP_ID = '29457813';

// Deliberate opt-in gates: importing drafts alone never enables customer sales or fulfillment.
export function printifyCommerceReady(env) {
  const yes = (value) => String(value || '').trim().toLowerCase() === 'true';
  const productionStoreKey = ['sk_live_', 'rk_live_'].some((prefix) => String(env.STRIPE_STORE_SECRET_KEY || '').startsWith(prefix));
  const storeWebhookReady = String(env.STRIPE_STORE_WEBHOOK_SECRET || '').startsWith('whsec_');
  const taxIsConfigured = ['stripe_automatic', 'none_confirmed'].includes(String(env.STORE_TAX_MODE || ''));
  return String(env.STORE_ENV || '') === 'production' &&
    productionStoreKey &&
    storeWebhookReady &&
    taxIsConfigured &&
    yes(env.PRINTIFY_LIVE_CHECKOUT_ENABLED) &&
    yes(env.PRINTIFY_ORDER_SUBMISSION_ENABLED) &&
    yes(env.PRINTIFY_MANUAL_APPROVAL_CONFIRMED);
}

export async function printifyRequest(env, path, { method = 'GET', body } = {}) {
  const token = String(env.PRINTIFY_API_TOKEN || '').trim();
  if (!token) throw new HttpError(503, 'Printify is not configured for this environment');
  const response = await fetch(PRINTIFY_API + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      'User-Agent': 'PokePrizePool Store Integration',
      Accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    console.error('Printify API request failed', response.status, path);
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(502, 'Printify rejected the configured token. Check its permissions and expiration.');
    }
    throw new HttpError(502, 'Printify could not complete the request. Please try again later.');
  }
  if (response.status === 204) return {};
  const responseText = await response.text();
  if (!responseText.trim()) return {};
  try { return JSON.parse(responseText); }
  catch {
    console.error('Printify API returned a non-JSON success response', path);
    throw new HttpError(502, 'Printify returned an unexpected response. Please review the order before retrying.');
  }
}

export function parseVariants(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const cleanText = (value, max = 120) => String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);

export function normalizePrintifyAddress(raw, email, allowedCountries = 'US') {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Enter a shipping address before calculating shipping.');
  const fullName = cleanText(raw.fullName || raw.name, 160);
  const space = fullName.indexOf(' ');
  const firstName = cleanText(space < 0 ? fullName : fullName.slice(0, space), 80);
  const lastName = cleanText(space < 0 ? '' : fullName.slice(space + 1), 80);
  const address1 = cleanText(raw.address1, 160);
  const address2 = cleanText(raw.address2, 160);
  const city = cleanText(raw.city, 100);
  const region = cleanText(raw.region || raw.state, 100);
  const zip = cleanText(raw.zip || raw.postalCode, 24);
  const country = cleanText(raw.country || 'US', 2).toUpperCase();
  const phone = cleanText(raw.phone, 40);
  const cleanEmail = cleanText(email || raw.email, 200);
  const allowed = String(allowedCountries || 'US').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!firstName || !lastName) throw new HttpError(400, 'Enter first and last name for the shipping label.');
  if (!address1 || !city || !region || !zip) throw new HttpError(400, 'Complete the street, city, state, and ZIP code fields.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) throw new HttpError(400, 'Enter a valid email address for the shipping confirmation.');
  if (!/^[A-Z]{2}$/.test(country) || !allowed.includes(country)) throw new HttpError(400, 'Shipping to that country is not enabled for this store.');
  return {
    first_name: firstName,
    last_name: lastName,
    email: cleanEmail,
    ...(phone ? { phone } : {}),
    country,
    region,
    address1,
    ...(address2 ? { address2 } : {}),
    city,
    zip,
  };
}

export async function quotePrintifyShipping(env, lineItems, addressTo) {
  if (!Array.isArray(lineItems) || !lineItems.length) throw new HttpError(400, 'No Printify items were supplied for the shipping quote.');
  const result = await printifyRequest(env, `shops/${PRINTIFY_SHOP_ID}/orders/shipping.json`, {
    method: 'POST',
    body: { line_items: lineItems, address_to: addressTo },
  });
  const standard = Number(result?.standard);
  if (!Number.isInteger(standard) || standard < 0 || standard > 100000) {
    throw new HttpError(502, 'Printify did not return a valid standard shipping rate for this address and cart.');
  }
  return { shippingCents: standard, shippingMethod: 1, methodName: 'Standard shipping' };
}
