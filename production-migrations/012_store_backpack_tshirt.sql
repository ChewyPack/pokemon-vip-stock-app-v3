-- Add the approved PokePrizePool backpack and T-shirt to the production store catalog.
-- Run once against the production pokemon-vip-members D1 database.
-- Both products remain unavailable for purchase until on-site checkout and fulfillment are ready.
-- Product photos can be added to the images field once the approved mockup images are supplied.

INSERT OR IGNORE INTO store_products
  (slug, name, description, sku, category, product_type, price_cents, inventory, active, preorder, images, external_checkout_url, coming_soon)
VALUES
  (
    'pokeprizepool-backpack',
    'PokePrizePool Backpack',
    'PokePrizePool branded backpack. One bag size. Coming soon — purchases will open through the PokePrizePool store checkout.',
    'PPP-ACCESSORY-BACKPACK',
    'accessories',
    'Backpack',
    6000,
    0,
    1,
    0,
    '[]',
    NULL,
    1
  ),
  (
    'pokeprizepool-tshirt',
    'PokePrizePool T-Shirt',
    'PokePrizePool branded T-shirt made with a Gildan 5000 tee. Available options planned: five colors and eight sizes (40 variants total). Coming soon — purchases will open through the PokePrizePool store checkout.',
    'PPP-APPAREL-TSHIRT',
    'merch',
    'T-Shirt',
    2500,
    0,
    1,
    0,
    '[]',
    NULL,
    1
  );
