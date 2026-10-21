-- Run ONLY against the staging D1 database: pokemon-vip-members-staging.
-- Separates the tier that controls benefits from the tier currently billed by Stripe.
-- Do not run this against production.
ALTER TABLE accounts ADD COLUMN membership_entitlement_tier TEXT;
UPDATE accounts
SET membership_entitlement_tier = membership_tier
WHERE membership_entitlement_tier IS NULL;
