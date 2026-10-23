-- PRODUCTION D1 MIGRATION: apply to pokemon-vip-members only.
-- Adds the parent/child relationship needed for direct replies to News Feed comments.
-- Run once, after confirming collector_post_comments exists. Do not run against staging.
ALTER TABLE collector_post_comments
  ADD COLUMN parent_comment_id INTEGER REFERENCES collector_post_comments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_collector_post_comments_parent
  ON collector_post_comments(post_id, parent_comment_id, created_at ASC, id ASC);
