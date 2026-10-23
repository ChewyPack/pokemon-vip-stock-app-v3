-- PRODUCTION D1 MIGRATION: enables direct replies to Community Feed comments.
-- Apply to pokemon-vip-members only as part of the reviewed production release.
-- Do NOT run against pokemon-vip-members-staging.
-- Run this migration once. SQLite does not support ADD COLUMN IF NOT EXISTS;
-- if parent_comment_id already exists, skip the ALTER TABLE statement and
-- run only the CREATE INDEX statement below.

ALTER TABLE collector_post_comments
  ADD COLUMN parent_comment_id INTEGER
  REFERENCES collector_post_comments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_collector_post_comments_parent
  ON collector_post_comments(parent_comment_id, created_at ASC, id ASC);
