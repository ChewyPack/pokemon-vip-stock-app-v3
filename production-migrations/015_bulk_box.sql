PRAGMA foreign_keys = ON;

-- Dedicated shared bulk inventory. Existing vendor shop listings remain unchanged.
CREATE TABLE IF NOT EXISTS bulk_box_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tcgcsv_product_id INTEGER,
  item_name TEXT NOT NULL,
  set_name TEXT NOT NULL DEFAULT '',
  card_number TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  condition_label TEXT NOT NULL DEFAULT 'Near Mint',
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 9999),
  price_cents INTEGER NOT NULL CHECK (price_cents IN (0,25,50,75,100,200,300,400,500)),
  is_published INTEGER NOT NULL DEFAULT 1 CHECK (is_published IN (0,1)),
  show_in_shop INTEGER NOT NULL DEFAULT 0 CHECK (show_in_shop IN (0,1)),
  show_in_ripz INTEGER NOT NULL DEFAULT 0 CHECK (show_in_ripz IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bulk_box_public_price
  ON bulk_box_items(is_published,price_cents,item_name);
CREATE INDEX IF NOT EXISTS idx_bulk_box_owner
  ON bulk_box_items(account_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bulk_box_catalog_product
  ON bulk_box_items(tcgcsv_product_id);
