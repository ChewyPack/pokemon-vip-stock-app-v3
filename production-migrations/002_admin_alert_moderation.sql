-- Run this migration on the production D1 database before deploying the admin alert moderation code.
-- Reports remain intact; this table only hides selected report IDs from the public stock feed.
CREATE TABLE IF NOT EXISTS admin_hidden_reports (
  report_id INTEGER PRIMARY KEY,
  hidden_by_account_id INTEGER,
  hidden_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_hidden_reports_hidden_at ON admin_hidden_reports(hidden_at);
