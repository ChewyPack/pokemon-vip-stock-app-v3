-- Run ONLY against the staging D1 database: pokemon-vip-members-staging.
-- Adds account-page billing details and scheduled-cancellation state.
ALTER TABLE accounts ADD COLUMN membership_interval TEXT;
ALTER TABLE accounts ADD COLUMN membership_cancel_at_period_end INTEGER NOT NULL DEFAULT 0;
