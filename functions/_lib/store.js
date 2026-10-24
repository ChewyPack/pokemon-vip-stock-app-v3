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

export const publicProduct = (r) => ({
  id: r.id, slug: r.slug, name: r.name, description: r.description, sku: r.sku,
  category: r.category, productType: r.product_type, set: r.set_name, language: r.language,
  condition: r.condition, gradeCompany: r.grade_company, grade: r.grade,
  priceCents: r.price_cents, compareAtCents: r.compare_at_cents,
  available: r.inventory, preorder: !!r.preorder, comingSoon: !!r.coming_soon, releaseDate: r.release_date,
  externalCheckoutUrl: r.external_checkout_url || null,
  images: JSON.parse(r.images || '[]'), createdAt: r.created_at,
});
