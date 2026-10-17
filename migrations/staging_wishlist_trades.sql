-- Staging-only wishlist matching, approximate location, and trade offers.
-- Run ONLY against pokemon-vip-members-staging.
-- Apply once. This migration preserves existing collector profiles and items.

ALTER TABLE collector_profiles ADD COLUMN location_zip TEXT NOT NULL DEFAULT '';
ALTER TABLE collector_profiles ADD COLUMN location_lat REAL;
ALTER TABLE collector_profiles ADD COLUMN location_lng REAL;
ALTER TABLE collector_profiles ADD COLUMN location_enabled INTEGER NOT NULL DEFAULT 0 CHECK (location_enabled IN (0, 1));
ALTER TABLE collector_profiles ADD COLUMN search_radius_miles INTEGER NOT NULL DEFAULT 25 CHECK (search_radius_miles IN (10, 25, 50, 100));

ALTER TABLE collector_items ADD COLUMN is_tradeable INTEGER NOT NULL DEFAULT 0 CHECK (is_tradeable IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_collector_items_wishlist_match
  ON collector_items(list_type, product_type, product_name, set_name, card_number, account_id);
CREATE INDEX IF NOT EXISTS idx_collector_items_tradeable
  ON collector_items(account_id, list_type, is_tradeable);

CREATE TABLE IF NOT EXISTS collector_trade_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposer_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  recipient_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'completed')),
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (proposer_account_id <> recipient_account_id)
);

CREATE INDEX IF NOT EXISTS idx_collector_trade_recipient_status
  ON collector_trade_offers(recipient_account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collector_trade_proposer_status
  ON collector_trade_offers(proposer_account_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS collector_trade_offer_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id INTEGER NOT NULL REFERENCES collector_trade_offers(id) ON DELETE CASCADE,
  collector_item_id INTEGER NOT NULL REFERENCES collector_items(id) ON DELETE RESTRICT,
  side TEXT NOT NULL CHECK (side IN ('offering', 'requesting')),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 9999),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_collector_trade_offer_items_offer
  ON collector_trade_offer_items(offer_id, side);

CREATE TABLE IF NOT EXISTS collector_trade_completions (
  offer_id INTEGER NOT NULL REFERENCES collector_trade_offers(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (offer_id, account_id)
);
