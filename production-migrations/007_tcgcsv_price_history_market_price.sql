-- PRODUCTION D1 MIGRATION: apply only to pokemon-vip-members.
-- Production catalog schema was introduced in production-migrations/001_account_and_collector_features.sql.
-- The sync Worker writes market_price into tcgcsv_price_history, so add that missing history field.
ALTER TABLE tcgcsv_price_history ADD COLUMN market_price REAL;
