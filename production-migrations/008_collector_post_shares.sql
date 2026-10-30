-- PRODUCTION D1 MIGRATION: apply to pokemon-vip-members only after the repost/quote feature code is deployed.
-- Re-runnable. Reposts are unique per account and original post; quote posts remain independently creatable.
CREATE TABLE IF NOT EXISTS collector_post_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES collector_posts(id) ON DELETE CASCADE,
  share_type TEXT NOT NULL CHECK (share_type IN ('repost','quote')),
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((share_type = 'repost' AND body = '') OR (share_type = 'quote' AND length(body) <= 2000))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collector_post_shares_unique_repost
  ON collector_post_shares(account_id, post_id) WHERE share_type = 'repost';
CREATE INDEX IF NOT EXISTS idx_collector_post_shares_feed
  ON collector_post_shares(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_collector_post_shares_post
  ON collector_post_shares(post_id, share_type);
