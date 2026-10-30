-- PRODUCTION D1 MIGRATION: apply to pokemon-vip-members only after the Stories feature is ready to deploy.
-- Safe to re-run. Creates 24-hour collector Stories and per-viewer read tracking.
-- Do not run this in a staging database.
CREATE TABLE IF NOT EXISTS collector_stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image','video')),
  media_url TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collector_stories_active
  ON collector_stories(expires_at DESC, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_collector_stories_account
  ON collector_stories(account_id, expires_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS collector_story_views (
  story_id INTEGER NOT NULL REFERENCES collector_stories(id) ON DELETE CASCADE,
  viewer_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (story_id, viewer_account_id)
);
CREATE INDEX IF NOT EXISTS idx_collector_story_views_viewer
  ON collector_story_views(viewer_account_id, story_id);
