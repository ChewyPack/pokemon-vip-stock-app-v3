export const MARKETPLACE_BOOST_PLANS = {
  3: { days: 3, amount_cents: 299, name: "3-day listing boost" },
  7: { days: 7, amount_cents: 499, name: "7-day listing boost" },
  14: { days: 14, amount_cents: 899, name: "14-day listing boost" }
};

export async function ensureMarketplaceBoostSchema(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS marketplace_listing_boosts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      stripe_session_id TEXT NOT NULL UNIQUE,
      amount_paid_cents INTEGER NOT NULL,
      duration_days INTEGER NOT NULL CHECK(duration_days IN (3,7,14)),
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_marketplace_listing_boosts_active ON marketplace_listing_boosts(listing_id, ends_at)").run();
}

function cookie(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const item = part.trim();
    if (item.startsWith(name + "=")) return item.slice(name.length + 1);
  }
  return "";
}
function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function sha256(value) {
  return base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
export async function currentMarketplaceAccount(request, env) {
  const token = cookie(request, "collector_session");
  if (!token || !env.DB) return null;
  const account = await env.DB.prepare(
    "SELECT id, email, session_expires_at FROM accounts WHERE session_token_hash = ? LIMIT 1"
  ).bind(await sha256(token)).first();
  if (!account || !account.session_expires_at || Number(account.session_expires_at) <= Date.now()) return null;
  return { id: Number(account.id), email: String(account.email || "") };
}

export async function applyMarketplaceBoostCheckout(session, env) {
  await ensureMarketplaceBoostSchema(env);
  const metadata = session?.metadata || {};
  const accountId = Number(metadata.account_id || 0);
  const listingId = Number(metadata.listing_id || 0);
  const days = Number(metadata.duration_days || 0);
  const plan = MARKETPLACE_BOOST_PLANS[days];
  if (session?.mode !== "payment" ||
      !["paid", "no_payment_required"].includes(session?.payment_status) ||
      metadata.purchase_type !== "marketplace_listing_boost" ||
      !Number.isSafeInteger(accountId) || accountId < 1 ||
      !Number.isSafeInteger(listingId) || listingId < 1 ||
      !plan || Number(session.amount_total) !== plan.amount_cents ||
      String(session.currency || "").toLowerCase() !== "usd" ||
      !String(session.id || "").startsWith("cs_")) return false;

  const alreadyApplied = await env.DB.prepare(
    "SELECT id FROM marketplace_listing_boosts WHERE stripe_session_id = ? LIMIT 1"
  ).bind(session.id).first();
  if (alreadyApplied) return true;

  const listing = await env.DB.prepare(
    "SELECT id, account_id, is_for_sale, listing_status FROM vendor_inventory WHERE id = ? LIMIT 1"
  ).bind(listingId).first();
  if (!listing || Number(listing.account_id) !== accountId ||
      Number(listing.is_for_sale) !== 1 || listing.listing_status !== "active") {
    console.error("Paid listing boost could not be applied because the listing is no longer eligible.", { listingId, accountId });
    return false;
  }

  const current = await env.DB.prepare(
    "SELECT MAX(ends_at) AS ends_at FROM marketplace_listing_boosts WHERE listing_id = ? AND ends_at > CURRENT_TIMESTAMP"
  ).bind(listingId).first();
  const now = Date.now();
  const existingEnd = current?.ends_at ? Date.parse(String(current.ends_at).replace(" ", "T") + "Z") : 0;
  const startMs = Number.isFinite(existingEnd) && existingEnd > now ? existingEnd : now;
  const startsAt = new Date(startMs).toISOString().slice(0, 19).replace("T", " ");
  const endsAt = new Date(startMs + plan.days * 86400000).toISOString().slice(0, 19).replace("T", " ");
  await env.DB.prepare(
    "INSERT OR IGNORE INTO marketplace_listing_boosts (listing_id, account_id, stripe_session_id, amount_paid_cents, duration_days, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(listingId, accountId, session.id, plan.amount_cents, plan.days, startsAt, endsAt).run();
  const confirmed = await env.DB.prepare(
    "SELECT id FROM marketplace_listing_boosts WHERE stripe_session_id = ? LIMIT 1"
  ).bind(session.id).first();
  return Boolean(confirmed);
}
