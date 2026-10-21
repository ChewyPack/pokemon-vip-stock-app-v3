-- Apply ONLY to pokemon-vip-members-staging during initial rollout.
-- Creates report storage for a fresh staging database and browser notification tables.
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  product TEXT NOT NULL DEFAULT '',
  quantity INTEGER,
  price REAL,
  reported_by TEXT NOT NULL DEFAULT '',
  photo_url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  price_type TEXT NOT NULL DEFAULT '',
  product_located TEXT NOT NULL DEFAULT '',
  seen_at TEXT NOT NULL DEFAULT '',
  still_there TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  branch_id TEXT NOT NULL DEFAULT '',
  store_town TEXT NOT NULL DEFAULT '',
  store_address TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  quantity_text TEXT NOT NULL DEFAULT '',
  shelf_price REAL,
  msrp REAL,
  report_type TEXT NOT NULL DEFAULT 'stock',
  line_count INTEGER,
  stocked_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at);
CREATE INDEX IF NOT EXISTS idx_reports_report_type_created_at ON reports(report_type, created_at);

CREATE TABLE IF NOT EXISTS notification_preferences (
  account_id INTEGER PRIMARY KEY,
  in_app_enabled INTEGER NOT NULL DEFAULT 1,
  browser_push_enabled INTEGER NOT NULL DEFAULT 0,
  states_json TEXT NOT NULL DEFAULT '[]',
  retailers_json TEXT NOT NULL DEFAULT '[]',
  stock_alerts_enabled INTEGER NOT NULL DEFAULT 1,
  line_alerts_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_account ON push_subscriptions(account_id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  notification_type TEXT NOT NULL DEFAULT 'stock',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '/market-intelligence.html',
  data_json TEXT NOT NULL DEFAULT '{}',
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notifications_account_created ON notifications(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(account_id, read_at);
