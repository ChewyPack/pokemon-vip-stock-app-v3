-- Run ONLY on pokemon-vip-members-staging AFTER staging_vendor_tools.sql has succeeded.
-- This extends the vendor dashboard data for a real sellable storefront.
ALTER TABLE vendor_profiles ADD COLUMN logo_key TEXT NOT NULL DEFAULT '';
ALTER TABLE vendor_profiles ADD COLUMN cover_key TEXT NOT NULL DEFAULT '';
ALTER TABLE vendor_inventory ADD COLUMN price_cents INTEGER;
ALTER TABLE vendor_inventory ADD COLUMN condition_label TEXT NOT NULL DEFAULT '';
ALTER TABLE vendor_inventory ADD COLUMN image_key TEXT NOT NULL DEFAULT '';
ALTER TABLE vendor_inventory ADD COLUMN is_for_sale INTEGER NOT NULL DEFAULT 1;
ALTER TABLE vendor_inventory ADD COLUMN listing_status TEXT NOT NULL DEFAULT 'active';
CREATE INDEX IF NOT EXISTS idx_vendor_inventory_sale ON vendor_inventory(account_id, is_for_sale, listing_status, created_at);
