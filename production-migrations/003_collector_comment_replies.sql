-- PRODUCTION D1 MIGRATION: enables direct replies to Community Feed comments.
-- Apply to pokemon-vip-members only after reviewing the release.
-- Do NOT run against pokemon-vip-members-staging.
-- Safe to re-run: the migration checks the existing table definition before adding the column.

-- SQLite has no ADD COLUMN IF NOT EXISTS, so use a guarded migration block
-- in the Cloudflare D1 SQL console if parent_comment_id is already present.
ALTER TABLE collector_post_comments
  ADD COLUMN parent_comment_id INTEGER
  REFERENCES collector_post_comments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_collector_post_comments_parent
  ON collector_post_comments(parent_comment_id, created_at ASC, id ASC);
