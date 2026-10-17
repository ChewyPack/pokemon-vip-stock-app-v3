-- STAGING ONLY: apply to pokemon-vip-members-staging, never production until reviewed.
-- Adds server-controlled admin access and the minimum account fields for verified SMS alerts.
-- Assumes staging_accounts.sql, staging_account_type.sql, and staging_account_phone.sql have been applied.
ALTER TABLE accounts ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1));
ALTER TABLE accounts ADD COLUMN phone_verified_at TEXT;
ALTER TABLE accounts ADD COLUMN sms_alerts_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sms_alerts_enabled IN (0, 1));
ALTER TABLE accounts ADD COLUMN sms_alert_consent_at TEXT;

CREATE INDEX IF NOT EXISTS idx_accounts_phone_number
  ON accounts(phone_number);

CREATE TABLE IF NOT EXISTS phone_verification_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_number TEXT NOT NULL,
  verification_provider TEXT NOT NULL DEFAULT 'twilio',
  provider_verification_sid TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'expired', 'failed')),
  verified_at TEXT,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_phone_verification_phone_status
  ON phone_verification_sessions(phone_number, status, expires_at);
