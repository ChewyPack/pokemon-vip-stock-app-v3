const COOKIE = 'collector_session';

export function eventPaymentsJson(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
function cookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const value = part.trim();
    if (value.startsWith(name + '=')) return value.slice(name.length + 1);
  }
  return '';
}
function b64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');
}
async function sha256(value) {
  return b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
export async function currentEventPaymentsAccount(request, env) {
  if (!env.DB) return null;
  const token = cookie(request, COOKIE);
  if (!token) return null;
  const account = await env.DB.prepare('SELECT id, display_name, email, is_admin, session_expires_at FROM accounts WHERE session_token_hash = ? LIMIT 1').bind(await sha256(token)).first();
  return account && account.session_expires_at && Number(account.session_expires_at) > Date.now() ? account : null;
}
export async function ensureEventPaymentsSchema(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS event_connect_accounts (account_id INTEGER PRIMARY KEY, stripe_account_id TEXT NOT NULL UNIQUE, livemode INTEGER NOT NULL DEFAULT 0, details_submitted INTEGER NOT NULL DEFAULT 0, charges_enabled INTEGER NOT NULL DEFAULT 0, payouts_enabled INTEGER NOT NULL DEFAULT 0, requirements_due_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS event_sale_items (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL, owner_account_id INTEGER NOT NULL, item_type TEXT NOT NULL DEFAULT 'admission' CHECK(item_type IN ('admission','booth','table')), title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 50), quantity_total INTEGER CHECK(quantity_total IS NULL OR quantity_total > 0), quantity_reserved INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  const itemColumns = await env.DB.prepare('PRAGMA table_info(event_sale_items)').all();
  const itemNames = new Set((itemColumns.results || []).map(column => column.name));
  if (!itemNames.has('quantity_reserved')) await env.DB.prepare('ALTER TABLE event_sale_items ADD COLUMN quantity_reserved INTEGER NOT NULL DEFAULT 0').run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_event_sale_items_event_active ON event_sale_items(event_id,is_active,id)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS event_sale_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL, item_id INTEGER NOT NULL, owner_account_id INTEGER NOT NULL, buyer_account_id INTEGER, connected_account_id TEXT NOT NULL, buyer_email TEXT NOT NULL DEFAULT '', buyer_name TEXT NOT NULL DEFAULT '', quantity INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL, total_amount_cents INTEGER NOT NULL, amount_refunded_cents INTEGER NOT NULL DEFAULT 0, stripe_fee_cents INTEGER, net_amount_cents INTEGER, stripe_balance_transaction_id TEXT, currency TEXT NOT NULL DEFAULT 'usd', stripe_checkout_session_id TEXT UNIQUE, stripe_payment_intent_id TEXT, status TEXT NOT NULL DEFAULT 'pending', dispute_status TEXT NOT NULL DEFAULT '', reservation_released INTEGER NOT NULL DEFAULT 0, reserved_until TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  const orderColumns = await env.DB.prepare('PRAGMA table_info(event_sale_orders)').all();
  const orderNames = new Set((orderColumns.results || []).map(column => column.name));
  if (!orderNames.has('reservation_released')) await env.DB.prepare('ALTER TABLE event_sale_orders ADD COLUMN reservation_released INTEGER NOT NULL DEFAULT 0').run();
  if (!orderNames.has('stripe_fee_cents')) await env.DB.prepare('ALTER TABLE event_sale_orders ADD COLUMN stripe_fee_cents INTEGER').run();
  if (!orderNames.has('net_amount_cents')) await env.DB.prepare('ALTER TABLE event_sale_orders ADD COLUMN net_amount_cents INTEGER').run();
  if (!orderNames.has('stripe_balance_transaction_id')) await env.DB.prepare('ALTER TABLE event_sale_orders ADD COLUMN stripe_balance_transaction_id TEXT').run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_event_sale_orders_event_created ON event_sale_orders(event_id,created_at DESC)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_event_sale_orders_owner_status ON event_sale_orders(owner_account_id,status)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_event_sale_orders_payment_intent ON event_sale_orders(stripe_payment_intent_id)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS event_connect_webhook_events (event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS event_connect_payout_activity (id INTEGER PRIMARY KEY AUTOINCREMENT, stripe_payout_id TEXT NOT NULL UNIQUE, connected_account_id TEXT NOT NULL, owner_account_id INTEGER, amount_cents INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'usd', status TEXT NOT NULL, arrival_date TEXT, failure_code TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_event_connect_payout_owner ON event_connect_payout_activity(owner_account_id,created_at DESC)").run();
}

export async function cleanupExpiredEventReservations(db) {
  await db.batch([
    db.prepare("UPDATE event_sale_items SET quantity_reserved=MAX(0,quantity_reserved-COALESCE((SELECT SUM(o.quantity) FROM event_sale_orders o WHERE o.item_id=event_sale_items.id AND o.reservation_released=0 AND o.reserved_until<=datetime('now') AND o.status IN ('pending','processing')),0)) WHERE EXISTS (SELECT 1 FROM event_sale_orders o WHERE o.item_id=event_sale_items.id AND o.reservation_released=0 AND o.reserved_until<=datetime('now') AND o.status IN ('pending','processing'))"),
    db.prepare("UPDATE event_sale_orders SET status='expired',reservation_released=1,updated_at=CURRENT_TIMESTAMP WHERE reservation_released=0 AND reserved_until<=datetime('now') AND status IN ('pending','processing')")
  ]);
}
export async function getOwnedEvent(env, eventId, account) {
  const event = await env.DB.prepare('SELECT id,title,event_date,status,owner_account_id,slug FROM poke_report_events WHERE id=? LIMIT 1').bind(eventId).first();
  if (!event) return null;
  const owns = Number(account?.is_admin || 0) === 1 || Number(event.owner_account_id || 0) === Number(account?.id || -1);
  return owns ? event : null;
}
export async function eventItemAvailability(db, itemId) {
  return db.prepare("SELECT i.*, COALESCE((SELECT SUM(o.quantity) FROM event_sale_orders o WHERE o.item_id=i.id AND o.status NOT IN ('refunded','failed','expired','pending','processing')),0) AS sold_count, i.quantity_reserved AS reserved_count FROM event_sale_items i WHERE i.id=? LIMIT 1").bind(itemId).first();
}
export function itemAvailability(item) {
  if (!item) return null;
  const total = item.quantity_total == null ? null : Number(item.quantity_total);
  const sold = Number(item.sold_count || 0);
  const reserved = Number(item.reserved_count || 0);
  return { sold_count: sold, reserved_count: reserved, available_quantity: total == null ? null : Math.max(0, total - sold - reserved) };
}
