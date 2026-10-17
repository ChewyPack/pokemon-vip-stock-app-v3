-- Staging-only collector follow relationships.
-- Apply to the pokemon-vip-members-staging D1 database before testing follows.
CREATE TABLE IF NOT EXISTS collector_follows (
  follower_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  followed_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follower_account_id, followed_account_id),
  CHECK (follower_account_id <> followed_account_id)
);
CREATE INDEX IF NOT EXISTS idx_collector_follows_followed ON collector_follows(followed_account_id);
CREATE INDEX IF NOT EXISTS idx_collector_follows_follower ON collector_follows(follower_account_id);
