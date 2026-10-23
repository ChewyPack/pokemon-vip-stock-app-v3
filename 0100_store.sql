-- PokePrizePool store schema. Additive only: creates new store_* tables, touches nothing existing.
-- Money is stored as integer cents.
CREATE TABLE IF NOT EXISTS store_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sku TEXT UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('sealed','singles','slabs','accessories','merch')),
  product_type TEXT,
  set_name TEXT,
  language TEXT,
  condition TEXT,
  grade_company TEXT,
  grade TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  compare_at_cents INTEGER CHECK (compare_at_cents IS NULL OR compare_at_cents > price_cents),
  inventory INTEGER NOT NULL DEFAULT 0 CHECK (inventory >= 0),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  preorder INTEGER NOT NULL DEFAULT 0 CHECK (preorder IN (0,1)),
  release_date TEXT,
  images TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_store_products_cat ON store_products(category, active);

CREATE TABLE IF NOT EXISTS store_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  public_token TEXT NOT NULL UNIQUE,
  account_id TEXT,
  email TEXT,
  shipping_name TEXT,
  shipping_address TEXT,
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  shipping_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','expired','failed','refunded','review')),
  fulfillment_status TEXT NOT NULL DEFAULT 'unfulfilled' CHECK (fulfillment_status IN ('unfulfilled','processing','shipped','delivered','cancelled')),
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent TEXT,
  tracking_carrier TEXT,
  tracking_number TEXT,
  restocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_store_orders_email ON store_orders(email);

CREATE TABLE IF NOT EXISTS store_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES store_orders(id),
  product_id INTEGER NOT NULL REFERENCES store_products(id),
  name TEXT NOT NULL,
  sku TEXT,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total_cents INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_store_items_order ON store_order_items(order_id);

-- Webhook idempotency: one row per processed Stripe event id.
CREATE TABLE IF NOT EXISTS store_stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS store_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
