-- Add an optional Printify-hosted checkout URL for print-on-demand apparel.
-- Run once against the production pokemon-vip-members D1 database before deploying
-- code that uses this field. This is additive and does not modify existing products.
ALTER TABLE store_products ADD COLUMN external_checkout_url TEXT;
