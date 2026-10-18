-- Run ONLY against the staging D1 database: pokemon-vip-members-staging.
-- Do not run this against production.
ALTER TABLE accounts ADD COLUMN membership_tier TEXT NOT NULL DEFAULT 'free';
ALTER TABLE accounts ADD COLUMN membership_status TEXT NOT NULL DEFAULT 'inactive';
ALTER TABLE accounts ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE accounts ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE accounts ADD COLUMN stripe_price_id TEXT;
ALTER TABLE accounts ADD COLUMN membership_current_period_end INTEGER;
ALTER TABLE accounts ADD COLUMN membership_source TEXT NOT NULL DEFAULT 'none';
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_stripe_subscription_id
  ON accounts(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS stripe_account_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
