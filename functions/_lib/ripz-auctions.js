const AUCTION_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ripz_auctions (
    id TEXT PRIMARY KEY,
    stream_id TEXT NOT NULL REFERENCES ripz_streams(id) ON DELETE CASCADE,
    seller_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL CHECK(item_type IN ('single','sealed','collectible')),
    item_title TEXT NOT NULL,
    item_description TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    starting_bid_cents INTEGER NOT NULL CHECK(starting_bid_cents >= 0),
    current_bid_cents INTEGER NOT NULL CHECK(current_bid_cents >= 0),
    bid_increment_cents INTEGER NOT NULL CHECK(bid_increment_cents > 0),
    buy_now_price_cents INTEGER CHECK(buy_now_price_cents IS NULL OR buy_now_price_cents > 0),
    duration_seconds INTEGER NOT NULL DEFAULT 60 CHECK(duration_seconds BETWEEN 15 AND 600),
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','scheduled','live','ended','sold','cancelled')),
    scheduled_at TEXT,
    started_at TEXT,
    ends_at TEXT,
    ended_at TEXT,
    winner_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    winning_bid_id INTEGER,
    version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS ripz_auction_bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    auction_id TEXT NOT NULL REFERENCES ripz_auctions(id) ON DELETE CASCADE,
    bidder_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
    idempotency_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(auction_id, idempotency_key)
  )`,
  `CREATE TABLE IF NOT EXISTS ripz_auction_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    auction_id TEXT NOT NULL REFERENCES ripz_auctions(id) ON DELETE CASCADE,
    actor_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL CHECK(event_type IN ('created','scheduled','started','bid_accepted','extended','ended','sold','cancelled')),
    event_data_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ripz_auctions_stream_status ON ripz_auctions(stream_id, status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ripz_auctions_seller_status ON ripz_auctions(seller_account_id, status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ripz_auctions_live_ends ON ripz_auctions(status, ends_at)`,
  `CREATE INDEX IF NOT EXISTS idx_ripz_auction_bids_auction ON ripz_auction_bids(auction_id, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ripz_auction_bids_bidder ON ripz_auction_bids(bidder_account_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ripz_auction_events_auction ON ripz_auction_events(auction_id, id DESC)`
];

export async function ensureRipzAuctionSchema(env) {
  if (!env?.DB) throw new Error("database_not_configured");
  for (const statement of AUCTION_SCHEMA) {
    await env.DB.prepare(statement).run();
  }
}

export function canHostRipzAuctions(account) {
  if (!account) return false;
  if (account.is_admin) return true;
  const status = String(account.membership_status || "").trim().toLowerCase();
  const tier = String(account.membership_tier || "").trim().toLowerCase().replace(/[_-]/g, " ").replace(/\\s+/g, " ");
  return ["active", "trialing"].includes(status) &&
    ["collector+", "collector plus", "vendor", "vendor+", "vendor plus"].includes(tier);
}
