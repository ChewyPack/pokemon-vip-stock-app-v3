export const EVENT_BOOST_PLANS = {
  3: { days: 3, amount_cents: 299, name: "3-day event boost" },
  7: { days: 7, amount_cents: 499, name: "7-day event boost" },
  14: { days: 14, amount_cents: 899, name: "14-day event boost" }
};

export async function ensureEventBoostSchema(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS poke_prize_event_boosts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      stripe_session_id TEXT NOT NULL UNIQUE,
      amount_paid_cents INTEGER NOT NULL,
      duration_days INTEGER NOT NULL CHECK(duration_days IN (3,7,14)),
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_poke_prize_event_boosts_active ON poke_prize_event_boosts(event_id, ends_at)").run();
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
export async function currentEventBoostAccount(request, env) {
  const token = cookie(request, "collector_session");
  if (!token || !env.DB) return null;
  const account = await env.DB.prepare(
    "SELECT id, email, is_admin, session_expires_at FROM accounts WHERE session_token_hash = ? LIMIT 1"
  ).bind(await sha256(token)).first();
  if (!account || !account.session_expires_at || Number(account.session_expires_at) <= Date.now()) return null;
  return {
    id: Number(account.id),
    email: String(account.email || ""),
    is_admin: Number(account.is_admin || 0) === 1
  };
}

export async function applyEventBoostCheckout(session, env) {
  await ensureEventBoostSchema(env);
  const metadata = session?.metadata || {};
  const accountId = Number(metadata.account_id || 0);
  const eventId = Number(metadata.event_id || 0);
  const days = Number(metadata.duration_days || 0);
  const plan = EVENT_BOOST_PLANS[days];
  if (session?.mode !== "payment" ||
      !["paid", "no_payment_required"].includes(session?.payment_status) ||
      metadata.purchase_type !== "event_boost" ||
      !Number.isSafeInteger(accountId) || accountId < 1 ||
      !Number.isSafeInteger(eventId) || eventId < 1 ||
      !plan || Number(session.amount_total) !== plan.amount_cents ||
      String(session.currency || "").toLowerCase() !== "usd" ||
      !String(session.id || "").startsWith("cs_")) return false;

  const alreadyApplied = await env.DB.prepare(
    "SELECT id FROM poke_prize_event_boosts WHERE stripe_session_id = ? LIMIT 1"
  ).bind(session.id).first();
  if (alreadyApplied) return true;

  const [buyer, event] = await Promise.all([
    env.DB.prepare("SELECT id, is_admin FROM accounts WHERE id = ? LIMIT 1").bind(accountId).first(),
    env.DB.prepare("SELECT id, owner_account_id, event_date, status FROM poke_report_events WHERE id = ? LIMIT 1").bind(eventId).first()
  ]);
  if (!buyer || !event || event.status !== "published" ||
      String(event.event_date || "") < new Date().toISOString().slice(0, 10) ||
      (Number(buyer.is_admin || 0) !== 1 && Number(event.owner_account_id) !== accountId)) {
    console.error("Paid event boost could not be applied because the event is no longer eligible.", { eventId, accountId });
    return false;
  }

  const current = await env.DB.prepare(
    "SELECT MAX(ends_at) AS ends_at FROM poke_prize_event_boosts WHERE event_id = ? AND ends_at > CURRENT_TIMESTAMP"
  ).bind(eventId).first();
  const now = Date.now();
  const existingEnd = current?.ends_at ? Date.parse(String(current.ends_at).replace(" ", "T") + "Z") : 0;
  const startMs = Number.isFinite(existingEnd) && existingEnd > now ? existingEnd : now;
  const startsAt = new Date(startMs).toISOString().slice(0, 19).replace("T", " ");
  const endsAt = new Date(startMs + plan.days * 86400000).toISOString().slice(0, 19).replace("T", " ");
  await env.DB.prepare(
    "INSERT OR IGNORE INTO poke_prize_event_boosts (event_id, account_id, stripe_session_id, amount_paid_cents, duration_days, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(eventId, accountId, session.id, plan.amount_cents, plan.days, startsAt, endsAt).run();
  const confirmed = await env.DB.prepare(
    "SELECT id FROM poke_prize_event_boosts WHERE stripe_session_id = ? LIMIT 1"
  ).bind(session.id).first();
  return Boolean(confirmed);
}
