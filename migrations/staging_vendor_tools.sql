-- Run ONLY against pokemon-vip-members-staging in Cloudflare D1.
-- Self-service vendor shop profiles, event appearances, booth locations, and show inventory.
CREATE TABLE IF NOT EXISTS vendor_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  shop_name TEXT NOT NULL DEFAULT '',
  logo_url TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
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
CREATE INDEX IF NOT EXISTS idx_vendor_events_account_date ON vendor_events(account_id, event_date);
CREATE TABLE IF NOT EXISTS vendor_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_id INTEGER REFERENCES vendor_events(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Singles',
  quantity_hint TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vendor_inventory_account_event ON vendor_inventory(account_id, event_id);
