CREATE TABLE IF NOT EXISTS line_service_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  discord TEXT NOT NULL,
  email TEXT NOT NULL,
  tier TEXT NOT NULL,
  store TEXT NOT NULL,
  address TEXT NOT NULL,
  request_date TEXT NOT NULL,
  opening_time TEXT NOT NULL DEFAULT '',
  release TEXT NOT NULL,
  service_type TEXT NOT NULL,
  duration_mode TEXT NOT NULL,
  hours TEXT NOT NULL DEFAULT '',
  products TEXT NOT NULL,
  quantities TEXT NOT NULL,
  budget TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  estimated_fee TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  email_status TEXT NOT NULL DEFAULT 'pending',
  email_error TEXT NOT NULL DEFAULT '',
  email_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_line_service_requests_created ON line_service_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_line_service_requests_email_status ON line_service_requests(email_status, created_at DESC);
