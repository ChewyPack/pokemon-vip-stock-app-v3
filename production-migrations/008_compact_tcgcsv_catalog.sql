-- PRODUCTION D1 MIGRATION: apply only to pokemon-vip-members.
-- Compact TCGCSV sync writes one product row with one preferred market price.
ALTER TABLE tcgcsv_products ADD COLUMN market_price REAL;
ALTER TABLE tcgcsv_products ADD COLUMN market_price_subtype TEXT;

-- Persistent cursor and measured row-write budget let the import pause safely
-- before the Free plan daily write ceiling and resume after midnight UTC.
ALTER TABLE tcgcsv_sync_progress ADD COLUMN current_group_offset INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tcgcsv_sync_progress ADD COLUMN sync_day TEXT;
ALTER TABLE tcgcsv_sync_progress ADD COLUMN rows_written_today INTEGER NOT NULL DEFAULT 0;

-- Prefix indexes keep common name/card-number searches from scanning the full catalog.
CREATE INDEX IF NOT EXISTS idx_tcgcsv_products_name_nocase
  ON tcgcsv_products(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_tcgcsv_products_card_number_nocase
  ON tcgcsv_products(card_number COLLATE NOCASE);
