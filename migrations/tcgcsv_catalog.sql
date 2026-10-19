-- PokePrizePool TCGCSV catalog and daily price sync.
-- Apply ONLY to the pokemon-vip-members-staging D1 database first.

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

CREATE INDEX IF NOT EXISTS idx_tcgcsv_groups_category_name
  ON tcgcsv_groups(category_id, name);

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

CREATE INDEX IF NOT EXISTS idx_tcgcsv_products_group
  ON tcgcsv_products(group_id);

CREATE INDEX IF NOT EXISTS idx_tcgcsv_products_type_name
  ON tcgcsv_products(product_type, name);

CREATE INDEX IF NOT EXISTS idx_tcgcsv_products_clean_name
  ON tcgcsv_products(clean_name);

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

CREATE INDEX IF NOT EXISTS idx_tcgcsv_prices_product
  ON tcgcsv_prices(product_id);

CREATE INDEX IF NOT EXISTS idx_tcgcsv_prices_market
  ON tcgcsv_prices(market_price);

-- Link member-owned and wishlisted items to the exact shared catalog record.
-- This preserves exact printing identity for collection/wishlist matching.
CREATE TABLE IF NOT EXISTS collector_item_catalog (
  item_id INTEGER PRIMARY KEY,
  tcgcsv_product_id INTEGER NOT NULL,
  FOREIGN KEY (item_id) REFERENCES collector_items(id) ON DELETE CASCADE,
  FOREIGN KEY (tcgcsv_product_id) REFERENCES tcgcsv_products(product_id)
);

CREATE INDEX IF NOT EXISTS idx_collector_item_catalog_product
  ON collector_item_catalog(tcgcsv_product_id);

-- One immutable snapshot per source build and printing variant for market trends.
CREATE TABLE IF NOT EXISTS tcgcsv_price_history (
  product_id INTEGER NOT NULL,
  subtype_name TEXT NOT NULL DEFAULT 'Normal',
  source_timestamp TEXT NOT NULL,
  low_price REAL,
  mid_price REAL,
  high_price REAL,
  market_price REAL,
  direct_low_price REAL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (product_id, subtype_name, source_timestamp)
);

CREATE INDEX IF NOT EXISTS idx_tcgcsv_price_history_product_time
  ON tcgcsv_price_history(product_id, source_timestamp);

CREATE INDEX IF NOT EXISTS idx_tcgcsv_price_history_time
  ON tcgcsv_price_history(source_timestamp);
