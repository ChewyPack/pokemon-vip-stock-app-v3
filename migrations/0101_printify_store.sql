-- Printify variant catalog and fulfillment bookkeeping. Additive only.
-- Apply this migration to the PRODUCTION pokemon-vip-members D1 before importing products.
ALTER TABLE store_products ADD COLUMN printify_shop_id TEXT;
ALTER TABLE store_products ADD COLUMN printify_product_id TEXT;
ALTER TABLE store_products ADD COLUMN printify_blueprint_id INTEGER;
ALTER TABLE store_products ADD COLUMN printify_print_provider_id INTEGER;
ALTER TABLE store_products ADD COLUMN printify_options TEXT NOT NULL DEFAULT '[]';
ALTER TABLE store_products ADD COLUMN printify_variants TEXT NOT NULL DEFAULT '[]';
ALTER TABLE store_products ADD COLUMN printify_synced_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_store_products_printify_identity
  ON store_products(printify_shop_id, printify_product_id)
  WHERE printify_shop_id IS NOT NULL AND printify_product_id IS NOT NULL;

ALTER TABLE store_order_items ADD COLUMN printify_shop_id TEXT;
ALTER TABLE store_order_items ADD COLUMN printify_product_id TEXT;
ALTER TABLE store_order_items ADD COLUMN printify_variant_id INTEGER;
ALTER TABLE store_order_items ADD COLUMN printify_variant_title TEXT;

ALTER TABLE store_orders ADD COLUMN printify_status TEXT NOT NULL DEFAULT 'not_applicable';
ALTER TABLE store_orders ADD COLUMN printify_order_id TEXT;
ALTER TABLE store_orders ADD COLUMN printify_error TEXT;
ALTER TABLE store_orders ADD COLUMN printify_last_attempt_at TEXT;
ALTER TABLE store_orders ADD COLUMN printify_submitted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_store_orders_printify_status
  ON store_orders(printify_status, payment_status);
