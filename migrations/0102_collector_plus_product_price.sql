-- Add optional Collector+ member pricing to store products. Additive only.
-- Run once against the production pokemon-vip-members D1 database before using the new field.
ALTER TABLE store_products ADD COLUMN collector_plus_price_cents INTEGER;
