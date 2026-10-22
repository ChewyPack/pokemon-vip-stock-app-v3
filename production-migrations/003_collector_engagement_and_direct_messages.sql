-- Optional production pre-provisioning for collector engagement features.
-- The runtime APIs also create these tables lazily if they are absent.
-- Run only against the intended production D1 database: pokemon-vip-members.
CREATE TABLE IF NOT EXISTS collector_direct_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  recipient_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_collector_direct_messages_conversation
  ON collector_direct_messages(sender_account_id, recipient_account_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_collector_direct_messages_recipient_unread
  ON collector_direct_messages(recipient_account_id, read_at, id DESC);

CREATE TABLE IF NOT EXISTS collector_post_views (
  post_id INTEGER NOT NULL REFERENCES collector_posts(id) ON DELETE CASCADE,
  viewer_key_hash TEXT NOT NULL,
  viewer_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, viewer_key_hash)
);
CREATE INDEX IF NOT EXISTS idx_collector_post_views_post
  ON collector_post_views(post_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_collector_post_views_creator
  ON collector_post_views(viewer_account_id, viewed_at DESC);
