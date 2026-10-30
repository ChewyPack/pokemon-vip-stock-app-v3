-- PRODUCTION D1 MIGRATION: apply to pokemon-vip-members only.
-- Safe to re-run. Preserves existing likes by importing each as the Like reaction.
CREATE TABLE IF NOT EXISTS collector_post_reactions (
  post_id INTEGER NOT NULL REFERENCES collector_posts(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL CHECK (reaction IN ('like','love','haha','wow','sad','angry')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_collector_post_reactions_post_type ON collector_post_reactions(post_id, reaction, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collector_post_reactions_account ON collector_post_reactions(account_id, post_id);
INSERT OR IGNORE INTO collector_post_reactions(post_id,account_id,reaction,created_at,updated_at)
SELECT post_id,account_id,'like',created_at,created_at FROM collector_post_likes;
