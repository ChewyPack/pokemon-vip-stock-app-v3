// Shared helpers for the store API (Cloudflare Pages Functions + D1).
export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

export const fail = (status, error) => json({ error }, status);

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function readJson(request, maxBytes = 20000) {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Request too large');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export const wrap = (fn) => async (ctx) => {
  try { return await fn(ctx); }
  catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.message);
    console.error('store api error', e);
    return fail(500, 'Something went wrong');
  }
};

// Use the site's existing signed collector session and server-verified admin flag.
import { currentChatAccount } from "./chat.js";

export async function requireAdmin({ request, env }) {
  const account = await currentChatAccount(request, env);
  if (!account || !account.is_admin) throw new HttpError(403, "Admin access required");
  return "account:" + account.id;
}

export function assertStoreStripeMode(env) {
  const mode = String(env.STORE_ENV || "");
  const key = String(env.STRIPE_STORE_SECRET_KEY || "");
  if (!["staging", "production"].includes(mode)) {
    throw new HttpError(503, "Store checkout is disabled until STORE_ENV is configured");
  }
  // Accept both standard secret keys (sk_...) and restricted API keys (rk_...),
  // while enforcing the environment's live/test mode.
  const allowedPrefixes = mode === "staging"
    ? ["sk_test_", "rk_test_"]
    : ["sk_live_", "rk_live_"];
  if (!allowedPrefixes.some((prefix) => key.startsWith(prefix))) {
    throw new HttpError(503, mode === "staging"
      ? "Store staging requires a Stripe test-mode secret or restricted key"
      : "Store production requires a Stripe live-mode secret or restricted key");
  }
}

export function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}

export function randomId(bytes = 16) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function orderNumber() {
  const a = crypto.getRandomValues(new Uint8Array(6));
  return 'PPP-' + [...a].map((b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
}

// Stripe expects form-encoded nested params: a[b][0][c]=v
export function formEncode(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') formEncode(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

export async function stripe(env, path, params) {
  assertStoreStripeMode(env);
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.STRIPE_STORE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: formEncode(params).join('&'),
  });
  const data = await res.json();
  if (!res.ok) { console.error('stripe error', data?.error?.message); throw new HttpError(502, 'Payment provider error'); }
  return data;
}

export async function verifyStripeSignature(raw, header, secret, tolerance = 300) {
  if (!header || !secret) return false;
  const pairs = header.split(',').map((p) => p.split('='));
  const t = pairs.find((p) => p[0] === 't')?.[1];
  const v1 = pairs.filter((p) => p[0] === 'v1').map((p) => p[1]);
  if (!t || !v1.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > tolerance) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${raw}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return v1.some((s) => timingSafeEqual(s, hex));
}

const safeJsonArray = (value) => { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; } };

// Printify descriptions arrive as HTML fragments. Convert them to readable text rather than
// exposing literal <p>/<li> markup on the public storefront.
export function plainTextDescription(value) {
  return String(value || '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*li(?:\s[^>]*)?>/gi, '• ')
    .replace(/<\s*\/\s*(p|li|ul|ol|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xA0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&copy;/gi, '©')
    .replace(/&reg;/gi, '®')
    .replace(/&trade;/gi, '™')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&#(?:x([0-9a-f]+)|(\d+));?/gi, (_, hex, dec) => {
      const code = hex ? parseInt(hex, 16) : parseInt(dec, 10);
      try { return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' '; }
      catch { return ' '; }
    })
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Additive, idempotent guard for production D1 instances receiving Collector+ pricing.
export async function ensureCollectorPlusPriceColumn(db) {
  let columns = await db.prepare('PRAGMA table_info(store_products)').all();
  if ((columns.results || []).some((column) => column.name === 'collector_plus_price_cents')) return;
  try {
    await db.prepare('ALTER TABLE store_products ADD COLUMN collector_plus_price_cents INTEGER').run();
  } catch (error) {
    // Concurrent first requests can race to add the same column. Accept only if it now exists.
    columns = await db.prepare('PRAGMA table_info(store_products)').all();
    if (!(columns.results || []).some((column) => column.name === 'collector_plus_price_cents')) throw error;
  }
}

export async function isCollectorPlusViewer(request, env) {
  try {
    const account = await currentChatAccount(request, env);
    if (!account) return false;
    if (account.is_admin) return true;
    const membership = await env.DB.prepare(
      'SELECT membership_status, membership_entitlement_tier, membership_tier FROM accounts WHERE id = ? LIMIT 1'
    ).bind(account.id).first();
    const status = String(membership?.membership_status || '').trim().toLowerCase();
    const tier = String(membership?.membership_entitlement_tier || membership?.membership_tier || '')
      .trim().toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ');
    return ['active', 'trialing'].includes(status) &&
      ['collector+', 'collector plus', 'vendor', 'vendor+', 'vendor plus', 'organizer', 'organizer+', 'event organizer'].includes(tier);
  } catch (error) {
    // Pricing must fail closed: if membership cannot be verified, use regular prices.
    console.error('Store Collector+ pricing eligibility check failed:', error);
    return false;
  }
}

export const publicProduct = (r) => {
  const printifyVariants = safeJsonArray(r.printify_variants);
  const printifyOptions = safeJsonArray(r.printify_options);
  const isPrintify = String(r.category || '').toLowerCase() === 'merch' && !!(r.printify_shop_id && r.printify_product_id);
  const makeableVariants = printifyVariants.filter((v) => v && v.enabled !== false && v.isAvailable !== false && Number(v.priceCents) >= 0);
  return {
    id: r.id, slug: r.slug, name: r.name, description: plainTextDescription(r.description), sku: r.sku,
    category: r.category, productType: r.product_type, set: r.set_name, language: r.language,
    condition: r.condition, gradeCompany: r.grade_company, grade: r.grade,
    priceCents: r.price_cents, compareAtCents: r.compare_at_cents,
    collectorPlusPriceCents: r.collector_plus_price_cents == null ? null : Number(r.collector_plus_price_cents),
    available: isPrintify ? (makeableVariants.length ? 1 : 0) : r.inventory,
    preorder: !!r.preorder, comingSoon: !!r.coming_soon, releaseDate: r.release_date,
    externalCheckoutUrl: r.external_checkout_url || null,
    isPrintify,
    madeToOrder: isPrintify,
    printifyVariants: isPrintify ? printifyVariants : [],
    printifyOptions: isPrintify ? printifyOptions : [],
    images: safeJsonArray(r.images), createdAt: r.created_at,
  };
};
