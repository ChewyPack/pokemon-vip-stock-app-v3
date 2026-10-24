-- Production-only: enables explicit admin-controlled public release of stock alerts.
-- No existing alerts are made public by this migration. Free accounts see no alerts
-- until an administrator explicitly publishes each report.
CREATE TABLE IF NOT EXISTS admin_public_reports (
  report_id INTEGER PRIMARY KEY,
  published_by_account_id INTEGER,
  published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_public_reports_published_at
  ON admin_public_reports(published_at);
