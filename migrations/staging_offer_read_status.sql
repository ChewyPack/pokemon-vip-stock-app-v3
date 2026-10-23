-- Staging-only: record when a recipient has read an incoming offer.
-- Run once against the staging D1 database before testing unread badges.
ALTER TABLE collector_trade_offers
ADD COLUMN recipient_read_at TEXT;
