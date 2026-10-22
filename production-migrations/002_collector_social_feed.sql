-- PRODUCTION D1 MIGRATION: apply to pokemon-vip-members only after the new code is ready to deploy.
-- Safe to re-run: tables and indexes use IF NOT EXISTS.
-- Do not run this in a staging database.
CREATE TABLE IF NOT EXISTS collector_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  post_type TEXT NOT NULL DEFAULT 'status'
    CHECK (post_type IN ('status','pull','collection','trade','question','event','restock')),
  image_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  CHECK (length(trim(body)) BETWEEN 1 AND 2000 OR length(trim(image_url)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_collector_posts_created ON collector_posts(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_collector_posts_account_created ON collector_posts(account_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS collector_post_likes (
  post_id INTEGER NOT NULL REFERENCES collector_posts(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_collector_post_likes_account ON collector_post_likes(account_id, post_id);

CREATE TABLE IF NOT EXISTS collector_post_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES collector_posts(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_collector_post_comments_post_created ON collector_post_comments(post_id, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_collector_post_comments_account ON collector_post_comments(account_id, post_id);

CREATE TABLE IF NOT EXISTS collector_post_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES collector_posts(id) ON DELETE CASCADE,
  reporter_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('spam','scam','harassment','inappropriate','misleading','other')),
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  UNIQUE(post_id, reporter_account_id)
);
CREATE INDEX IF NOT EXISTS idx_collector_post_reports_status ON collector_post_reports(status, created_at DESC);
