-- Staging-only collector blocking relationships.
-- Apply to pokemon-vip-members-staging D1 database.
CREATE TABLE IF NOT EXISTS collector_blocks (
  blocker_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  blocked_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_account_id, blocked_account_id),
  CHECK (blocker_account_id <> blocked_account_id)
);
CREATE INDEX IF NOT EXISTS idx_collector_blocks_blocked ON collector_blocks(blocked_account_id);
