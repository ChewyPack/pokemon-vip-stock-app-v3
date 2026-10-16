-- Run ONLY against the staging D1 database: pokemon-vip-members-staging.
-- Stores the pending next-renewal plan selected for an existing Test Mode subscription.
ALTER TABLE accounts ADD COLUMN membership_scheduled_tier TEXT;
ALTER TABLE accounts ADD COLUMN membership_scheduled_interval TEXT;
ALTER TABLE accounts ADD COLUMN membership_scheduled_price_id TEXT;
ALTER TABLE accounts ADD COLUMN membership_scheduled_at INTEGER;
