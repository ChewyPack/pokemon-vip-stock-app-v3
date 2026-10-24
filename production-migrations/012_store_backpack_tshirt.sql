-- Add the approved PokePrizePool backpack and T-shirt to the production store catalog.
-- Run once against the production pokemon-vip-members D1 database.
-- Both products remain unavailable for purchase until on-site checkout and fulfillment are ready.
-- Product images are public product mockups; customer checkout stays on PokePrizePool.

INSERT OR IGNORE INTO store_products
  (slug, name, description, sku, category, product_type, price_cents, inventory, active, preorder, images, external_checkout_url, coming_soon)
VALUES
  (
    'pokeprizepool-backpack',
    'PokePrizePool Backpack',
    'PokePrizePool branded backpack made from durable, quick-drying polyester, with a padded breathable back panel, adjustable shoulder straps, four compartments, and a laptop/tablet sleeve. One size. Coming soon — purchases will open through the PokePrizePool store checkout.',
    'PPP-ACCESSORY-BACKPACK',
    'accessories',
    'Backpack',
    6000,
    0,
    1,
    0,
    '["https://images-api.printify.com/mockup/6adcd90a5bb45b7c640f404c/61364/2984/pokeprizepool-backpack.jpg?camera_label=front&revision=1792858452032&s=2048","https://images-api.printify.com/mockup/6adcd90a5bb45b7c640f404c/61364/2986/pokeprizepool-backpack.jpg?camera_label=right-side&revision=1792858452032&s=400","https://images-api.printify.com/mockup/6adcd90a5bb45b7c640f404c/61364/2987/pokeprizepool-backpack.jpg?camera_label=left-side&revision=1792858452032&s=400","https://images-api.printify.com/mockup/6adcd90a5bb45b7c640f404c/61364/2988/pokeprizepool-backpack.jpg?camera_label=top&revision=1792858452032&s=400"]',
    NULL,
    1
  ),
  (
    'pokeprizepool-tshirt',
    'PokePrizePool T-Shirt',
    'PokePrizePool branded Gildan 5000 T-shirt. Available options planned: five colors and eight sizes (40 variants total). Coming soon — purchases will open through the PokePrizePool store checkout.',
    'PPP-APPAREL-TSHIRT',
    'merch',
    'T-Shirt',
    2500,
    0,
    1,
    0,
    '["https://images-api.printify.com/mockup/6adccf466ae28fd5270f5994/12100/102005/pokeprizepool.jpg?camera_label=front-2&revision=1792862417395&s=2048","https://images-api.printify.com/mockup/6adccf466ae28fd5270f5994/12100/102001/pokeprizepool.jpg?camera_label=folded&revision=1792862417395&s=400","https://images-api.printify.com/mockup/6adccf466ae28fd5270f5994/12100/127735/pokeprizepool.jpg?camera_label=folded-2&revision=1792862417395&s=400"]',
    NULL,
    1
  );
