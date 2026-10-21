-- Staging-only: support cash and trade offers.
-- Run once against pokemon-vip-members-staging only.
-- Existing offers remain trade offers by default.

ALTER TABLE collector_trade_offers
ADD COLUMN offer_type TEXT NOT NULL DEFAULT 'trade'
CHECK (offer_type IN ('cash', 'trade'));

ALTER TABLE collector_trade_offers
ADD COLUMN cash_amount_cents INTEGER
CHECK (cash_amount_cents IS NULL OR cash_amount_cents > 0);
