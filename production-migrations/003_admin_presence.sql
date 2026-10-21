-- Admin online presence tracking. Apply to the staging D1 database first.
CREATE TABLE IF NOT EXISTS site_presence (
  account_id INTEGER PRIMARY KEY,
  last_seen_at TEXT NOT NULL,
  current_page TEXT NOT NULL DEFAULT '',
  in_chat INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_site_presence_last_seen ON site_presence(last_seen_at);
