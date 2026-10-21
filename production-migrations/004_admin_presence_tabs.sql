-- Add per-tab presence so opening the admin dashboard in another tab does not overwrite chat presence.
-- Apply to production only after the staging preview is verified and PR #9 is approved.
CREATE TABLE IF NOT EXISTS site_presence_tabs (
  tab_id TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL,
  last_seen_at TEXT NOT NULL,
  current_page TEXT NOT NULL DEFAULT '',
  in_chat INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_site_presence_tabs_last_seen ON site_presence_tabs(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_site_presence_tabs_account ON site_presence_tabs(account_id, last_seen_at);
