-- PRODUCTION D1 migration for PokePrizePool's separate website-account system.
-- Run ONLY after reviewing the release and confirming the DB binding is pokemon-vip-members.
-- This creates new account/collector feature tables; it intentionally does NOT alter users,
-- legacy VIP sessions/subscriptions, or existing report rows.
-- Apply this file explicitly through the production D1 SQL console. Do not run the staging
-- migrations as a group, and do not run this against pokemon-vip-members-staging.

PRAGMA foreign_keys = ON;

-- Extend the existing production report schema without replacing or deleting old reports.
-- The old reports table does not contain product_type; this migration does not add it.
ALTER TABLE reports ADD COLUMN product_located TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN seen_at TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN still_there TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN state TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN branch_id TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN store_town TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN store_address TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN product_name TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN quantity_text TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN shelf_price REAL;
ALTER TABLE reports ADD COLUMN msrp REAL;
ALTER TABLE reports ADD COLUMN report_type TEXT NOT NULL DEFAULT 'stock';
ALTER TABLE reports ADD COLUMN line_count INTEGER;
ALTER TABLE reports ADD COLUMN stocked_by TEXT;
CREATE INDEX IF NOT EXISTS idx_reports_report_type_created_at
  ON reports(report_type, created_at);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  session_token_hash TEXT,
  session_expires_at INTEGER,
  account_type TEXT NOT NULL DEFAULT 'free'
    CHECK (account_type IN ('free', 'collector', 'vendor', 'organizer')),
  phone_number TEXT NOT NULL DEFAULT '',
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  sms_alerts_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sms_alerts_enabled IN (0, 1)),
  sms_alert_consent_at TEXT,
  membership_tier TEXT NOT NULL DEFAULT 'free',
  membership_entitlement_tier TEXT,
  membership_status TEXT NOT NULL DEFAULT 'inactive',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_price_id TEXT,
  membership_current_period_end INTEGER,
  membership_source TEXT NOT NULL DEFAULT 'none',
  membership_interval TEXT,
  membership_cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  membership_scheduled_tier TEXT,
  membership_scheduled_interval TEXT,
  membership_scheduled_price_id TEXT,
  membership_scheduled_at INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_accounts_session_token_hash
  ON accounts(session_token_hash);
CREATE INDEX IF NOT EXISTS idx_accounts_phone_number
  ON accounts(phone_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_stripe_subscription_id
  ON accounts(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS stripe_account_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS collector_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  bio TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  is_public INTEGER NOT NULL DEFAULT 1,
  location_zip TEXT NOT NULL DEFAULT '',
  location_lat REAL,
  location_lng REAL,
  location_enabled INTEGER NOT NULL DEFAULT 0 CHECK (location_enabled IN (0, 1)),
  search_radius_miles INTEGER NOT NULL DEFAULT 25 CHECK (search_radius_miles IN (10, 25, 50, 100)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_collector_profiles_username
  ON collector_profiles(username);

CREATE TABLE IF NOT EXISTS collector_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  list_type TEXT NOT NULL CHECK (list_type IN ('collection', 'wishlist')),
  product_type TEXT NOT NULL DEFAULT 'card' CHECK (product_type IN ('card', 'sealed', 'graded')),
  product_name TEXT NOT NULL,
  set_name TEXT NOT NULL DEFAULT '',
  card_number TEXT NOT NULL DEFAULT '',
  condition TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 9999),
  notes TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  estimated_value_cents INTEGER,
  is_tradeable INTEGER NOT NULL DEFAULT 0 CHECK (is_tradeable IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_collector_items_account_list
  ON collector_items(account_id, list_type, created_at DESC);
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
  recipient_read_at TEXT,
  offer_type TEXT NOT NULL DEFAULT 'trade' CHECK (offer_type IN ('cash', 'trade')),
  cash_amount_cents INTEGER CHECK (cash_amount_cents IS NULL OR cash_amount_cents > 0),
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

CREATE TABLE IF NOT EXISTS collector_follows (
  follower_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  followed_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follower_account_id, followed_account_id),
  CHECK (follower_account_id <> followed_account_id)
);
CREATE INDEX IF NOT EXISTS idx_collector_follows_followed
  ON collector_follows(followed_account_id);
CREATE INDEX IF NOT EXISTS idx_collector_follows_follower
  ON collector_follows(follower_account_id);

CREATE TABLE IF NOT EXISTS collector_blocks (
  blocker_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  blocked_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_account_id, blocked_account_id),
  CHECK (blocker_account_id <> blocked_account_id)
);
CREATE INDEX IF NOT EXISTS idx_collector_blocks_blocked
  ON collector_blocks(blocked_account_id);

CREATE TABLE IF NOT EXISTS vendor_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  shop_name TEXT NOT NULL DEFAULT '',
  logo_url TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  logo_key TEXT NOT NULL DEFAULT '',
  cover_key TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  website_url TEXT NOT NULL DEFAULT '',
  social_links TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vendor_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  event_date TEXT NOT NULL,
  venue_name TEXT NOT NULL DEFAULT '',
  venue_address TEXT NOT NULL DEFAULT '',
  booth_location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vendor_events_account_date
  ON vendor_events(account_id, event_date);

CREATE TABLE IF NOT EXISTS vendor_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_id INTEGER REFERENCES vendor_events(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Singles',
  quantity_hint TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  price_cents INTEGER,
  condition_label TEXT NOT NULL DEFAULT '',
  image_key TEXT NOT NULL DEFAULT '',
  is_for_sale INTEGER NOT NULL DEFAULT 1,
  listing_status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vendor_inventory_account_event
  ON vendor_inventory(account_id, event_id);
CREATE INDEX IF NOT EXISTS idx_vendor_inventory_sale
  ON vendor_inventory(account_id, is_for_sale, listing_status, created_at);

CREATE TABLE IF NOT EXISTS vendor_commerce_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  ticket_sales_approved INTEGER NOT NULL DEFAULT 0,
  booth_sales_approved INTEGER NOT NULL DEFAULT 0,
  reviewed_by_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  review_notes TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS instant_buyout_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('bulk', 'singles', 'slabs', 'sealed', 'collection', 'other')),
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  quantity TEXT NOT NULL DEFAULT '',
  condition_notes TEXT NOT NULL DEFAULT '',
  photo_urls TEXT NOT NULL DEFAULT '',
  asking_price_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'reviewing', 'offer_ready', 'accepted', 'declined', 'completed')),
  offer_amount_cents INTEGER,
  offer_notes TEXT NOT NULL DEFAULT '',
  partner_vendor_name TEXT NOT NULL DEFAULT '',
  partner_vendor_contact TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_instant_buyout_account_created
  ON instant_buyout_requests(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_instant_buyout_status_created
  ON instant_buyout_requests(status, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO chat_channels (slug, name, description, position) VALUES
 ('general','General','Collector chat, introductions, and everyday Pokémon talk.',1),
 ('restocks','Restocks & Finds','Share store sightings, pickups, and restock discussions.',2),
 ('market','Market Talk','Prices, collection goals, and Pokémon TCG market discussion.',3),
 ('trades','Trades & Collections','Show off your collection and discuss trades. Do not post payment details.',4),
 ('help','Help Desk','Ask the community for help with PokePrizePool and collecting.',5);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1200),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_created
  ON chat_messages(channel_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_account_created
  ON chat_messages(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_preferences (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  in_app_enabled INTEGER NOT NULL DEFAULT 1,
  browser_push_enabled INTEGER NOT NULL DEFAULT 0,
  states_json TEXT NOT NULL DEFAULT '[]',
  retailers_json TEXT NOT NULL DEFAULT '[]',
  stock_alerts_enabled INTEGER NOT NULL DEFAULT 1,
  line_alerts_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_account ON push_subscriptions(account_id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL DEFAULT 'stock',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '/market-intelligence.html',
  data_json TEXT NOT NULL DEFAULT '{}',
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_account_created ON notifications(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(account_id, read_at);

CREATE TABLE IF NOT EXISTS tcgcsv_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  source_timestamp TEXT,
  last_success_at TEXT,
  status TEXT NOT NULL DEFAULT 'never_synced',
  last_error TEXT
);
INSERT OR IGNORE INTO tcgcsv_sync_state (id, status) VALUES (1, 'never_synced');

CREATE TABLE IF NOT EXISTS tcgcsv_groups (
  group_id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  abbreviation TEXT,
  published_on TEXT,
  modified_on TEXT,
  last_seen_sync TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tcgcsv_groups_category_name ON tcgcsv_groups(category_id, name);

CREATE TABLE IF NOT EXISTS tcgcsv_products (
  product_id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  clean_name TEXT,
  image_url TEXT,
  product_url TEXT,
  product_type TEXT NOT NULL DEFAULT 'single',
  card_number TEXT,
  rarity TEXT,
  extended_data_json TEXT,
  last_seen_sync TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tcgcsv_products_group ON tcgcsv_products(group_id);
CREATE INDEX IF NOT EXISTS idx_tcgcsv_products_type_name ON tcgcsv_products(product_type, name);
CREATE INDEX IF NOT EXISTS idx_tcgcsv_products_clean_name ON tcgcsv_products(clean_name);

CREATE TABLE IF NOT EXISTS tcgcsv_prices (
  product_id INTEGER NOT NULL,
  subtype_name TEXT NOT NULL DEFAULT 'Normal',
  low_price REAL,
  mid_price REAL,
  high_price REAL,
  market_price REAL,
  direct_low_price REAL,
  last_seen_sync TEXT NOT NULL,
  PRIMARY KEY (product_id, subtype_name)
);
CREATE INDEX IF NOT EXISTS idx_tcgcsv_prices_product ON tcgcsv_prices(product_id);
CREATE INDEX IF NOT EXISTS idx_tcgcsv_prices_market ON tcgcsv_prices(market_price);

CREATE TABLE IF NOT EXISTS collector_item_catalog (
  item_id INTEGER PRIMARY KEY REFERENCES collector_items(id) ON DELETE CASCADE,
  tcgcsv_product_id INTEGER NOT NULL REFERENCES tcgcsv_products(product_id)
);
CREATE INDEX IF NOT EXISTS idx_collector_item_catalog_product ON collector_item_catalog(tcgcsv_product_id);

CREATE TABLE IF NOT EXISTS tcgcsv_price_history (
  product_id INTEGER NOT NULL,
  subtype_name TEXT NOT NULL DEFAULT 'Normal',
  source_timestamp TEXT NOT NULL,
  low_price REAL,
  mid_price REAL,
  high_price REAL,
  direct_low_price REAL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (product_id, subtype_name, source_timestamp)
);
CREATE INDEX IF NOT EXISTS idx_tcgcsv_price_history_product_time ON tcgcsv_price_history(product_id, source_timestamp);
CREATE INDEX IF NOT EXISTS idx_tcgcsv_price_history_time ON tcgcsv_price_history(source_timestamp);

CREATE TABLE IF NOT EXISTS tcgcsv_groups_staging (
  group_id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  abbreviation TEXT,
  published_on TEXT,
  modified_on TEXT,
  last_seen_sync TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tcgcsv_products_staging (
  product_id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  clean_name TEXT,
  image_url TEXT,
  product_url TEXT,
  product_type TEXT NOT NULL DEFAULT 'single',
  card_number TEXT,
  rarity TEXT,
  extended_data_json TEXT,
  last_seen_sync TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tcgcsv_prices_staging (
  product_id INTEGER NOT NULL,
  subtype_name TEXT NOT NULL DEFAULT 'Normal',
  low_price REAL,
  mid_price REAL,
  high_price REAL,
  direct_low_price REAL,
  market_price REAL,
  last_seen_sync TEXT NOT NULL,
  PRIMARY KEY (product_id, subtype_name)
);
CREATE TABLE IF NOT EXISTS tcgcsv_sync_progress (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  run_token TEXT,
  source_timestamp TEXT,
  group_ids_json TEXT,
  next_group_index INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO tcgcsv_sync_progress (id, next_group_index) VALUES (1, 0);
