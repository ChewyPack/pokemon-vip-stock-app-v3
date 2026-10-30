-- PRODUCTION D1 MIGRATION: add persistent Story Highlights without changing the 24-hour default.
-- Apply once to pokemon-vip-members. Do not run in staging.
ALTER TABLE collector_stories
  ADD COLUMN is_highlighted INTEGER NOT NULL DEFAULT 0 CHECK (is_highlighted IN (0,1));

CREATE INDEX IF NOT EXISTS idx_collector_stories_highlighted
  ON collector_stories(is_highlighted, created_at DESC, id DESC);
