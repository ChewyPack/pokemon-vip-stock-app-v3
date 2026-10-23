-- Staging migration: Instant Buyout request workflow.
CREATE TABLE IF NOT EXISTS instant_buyout_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('bulk','singles','slabs','sealed','collection','other')),
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  quantity TEXT NOT NULL DEFAULT '',
  condition_notes TEXT NOT NULL DEFAULT '',
  photo_urls TEXT NOT NULL DEFAULT '',
  asking_price_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','reviewing','offer_ready','accepted','declined','completed')),
  offer_amount_cents INTEGER,
  offer_notes TEXT NOT NULL DEFAULT '',
  partner_vendor_name TEXT NOT NULL DEFAULT '',
  partner_vendor_contact TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_instant_buyout_account_created
  ON instant_buyout_requests(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_instant_buyout_status_created
  ON instant_buyout_requests(status, created_at DESC);

-- Separate permission gate for future ticket/booth sales. Vendor+ membership alone
-- does not authorize sales. Only an administrator can approve this capability.
CREATE TABLE IF NOT EXISTS vendor_commerce_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL UNIQUE,
  ticket_sales_approved INTEGER NOT NULL DEFAULT 0,
  booth_sales_approved INTEGER NOT NULL DEFAULT 0,
  reviewed_by_account_id INTEGER,
  review_notes TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by_account_id) REFERENCES accounts(id) ON DELETE SET NULL
);
