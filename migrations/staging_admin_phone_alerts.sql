-- STAGING ONLY: apply to pokemon-vip-members-staging after reviewing dependencies.
-- Assumes staging_accounts.sql, staging_account_type.sql, staging_account_phone.sql,
-- and staging_collector_follows.sql have already been applied.
-- Phone is collected at signup, but phone verification is intentionally deferred to avoid Twilio costs.
ALTER TABLE accounts ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1));
ALTER TABLE accounts ADD COLUMN sms_alerts_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sms_alerts_enabled IN (0, 1));
ALTER TABLE accounts ADD COLUMN sms_alert_consent_at TEXT;

CREATE INDEX IF NOT EXISTS idx_accounts_phone_number
  ON accounts(phone_number);
