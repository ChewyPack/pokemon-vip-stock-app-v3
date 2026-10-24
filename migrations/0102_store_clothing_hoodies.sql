-- Add an explicit coming-soon state for store products and seed the approved PokePrizePool hoodies.
-- Run once against the production pokemon-vip-members D1 database before deploying code that reads coming_soon.
ALTER TABLE store_products ADD COLUMN coming_soon INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO store_products
  (slug, name, description, sku, category, product_type, price_cents, inventory, active, preorder, images, external_checkout_url, coming_soon)
VALUES
  (
    'peekachu-hoodie',
    'Peek@chu',
    'PokePrizePool hoodie featuring the Peek@chu design. Gildan 18500 Heavy Blend hoodie available in eight sizes. Coming soon — available for purchase on PokePrizePool when checkout opens.',
    'PPP-APPAREL-PEEKATCHU',
    'merch',
    'Hoodie',
    5000,
    0,
    1,
    0,
    '["https://images-api.printify.com/mockup/6adcc73d9a58dc3ccd0307b0/32920/98424/peek-at-chu.jpg?camera_label=front&revision=1792854594425"]',
    NULL,
    1
  ),
  (
    'luffychu-hoodie',
    'LuffyChu',
    'PokePrizePool hoodie featuring the LuffyChu design. Gildan 18500 Heavy Blend hoodie available in eight sizes. Coming soon — available for purchase on PokePrizePool when checkout opens.',
    'PPP-APPAREL-LUFFYCHU',
    'merch',
    'Hoodie',
    5000,
    0,
    1,
    0,
    '["https://images-api.printify.com/mockup/6adcc73e8d5081c79b04cda6/32920/98424/luffychu.jpg?camera_label=front&revision=1792854626799&s=2048"]',
    NULL,
    1
  );
