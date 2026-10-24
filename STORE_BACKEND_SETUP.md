# PokePrizePool Store integration

This branch integrates a direct-to-customer official store using Cloudflare Pages Functions, D1 and Stripe Checkout. It is separate from the Collector Marketplace and uses new store_* tables and /api/store/* endpoints.

## Repository paths
- Public catalog: GET /api/store/products
- Checkout: POST /api/store/checkout
- Customer order status: GET /api/store/order?n=<order number>&t=<token>
- Stripe store webhook: POST /api/store/webhook
- Admin products: GET/POST/PATCH /api/store/admin/products
- Admin orders: GET/PATCH /api/store/admin/orders
- Public storefront: /store.html
- Confirmation page: /store/order.html
- Product and fulfillment management: /store-admin.html
- Store schema: migrations/0100_store.sql

## Staging setup only — do not configure live checkout yet
1. Confirm the Cloudflare Pages preview deployment uses the staging D1 binding (pokemon-vip-members-staging), never the production DB.
2. Apply migrations/0100_store.sql to that staging database only. It creates separate store_* tables and does not alter membership tables.
3. Add these values to the Cloudflare Pages Preview environment only:
   - STORE_ENV=staging
   - STRIPE_STORE_SECRET_KEY — Stripe test-mode secret key (sk_test_...); use a dedicated store key, not the membership key.
   - STRIPE_STORE_WEBHOOK_SECRET — signing secret for the new staging webhook.
   - STORE_SHIPPING_OPTIONS — JSON array of real shipping options, e.g. [{"name":"Standard shipping","amountCents":599}]. Replace this example with actual pricing and delivery promise.
   - STORE_TAX_MODE=stripe_automatic (requires Stripe Tax enabled and configured), or none_confirmed only after confirming with a qualified tax adviser that no tax needs to be collected.
   - Optional: STORE_SHIP_COUNTRIES=US, STORE_TAX_CODE=txcd_99999999, STORE_SHIPPING_TAX_CODE=txcd_92010001.
4. In Stripe test mode, register https://<preview-host>/api/store/webhook with events checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, and checkout.session.expired. Copy that endpoint's whsec_... signing secret into STRIPE_STORE_WEBHOOK_SECRET. Keep the membership webhook and secret unchanged.
5. After redeploy, use /store-admin.html while signed in as a PokePrizePool admin to create test products, then test checkout and cancellation/expiration flows.

## Safety notes
- Checkout is disabled unless STORE_ENV is exactly staging or production, and its Stripe key prefix matches that mode (sk_test_ for staging, sk_live_ for production).
- The store uses STRIPE_STORE_SECRET_KEY rather than the existing membership STRIPE_SECRET_KEY.
- Admin endpoints use the existing hashed collector_session and accounts.is_admin verification. No shared admin token is used.
- Product prices and stock are read from D1; the client sends only product IDs and quantities.
- Store orders become paid only after a valid signed Stripe webhook.
- Stock reservation/restock behavior must be tested against staging D1 and Stripe test mode before launch.
- The backend has not yet been verified against Cloudflare or Stripe. Do not merge to main or activate production checkout until staging tests pass.



## Printify apparel listings

The official PokePrizePool storefront supports optional Printify-hosted product checkout links for merchandise. Add a product in `/store-admin.html`, paste the product's HTTPS `*.printify.me` URL, add its title, description, and mockup image URL, and publish it. The public store then shows “Shop on Printify” instead of putting the item in the PokePrizePool Stripe cart. Printify's hosted product page handles its own size/color selection, checkout, printing, and shipping; these links do not reserve local D1 inventory or create a PokePrizePool Stripe order.

Before deploying code that uses the new `store_products.external_checkout_url` column, apply `production-migrations/010_store_external_checkout.sql` once to the production `pokemon-vip-members` D1 database. Do not execute the same ALTER migration twice. Only HTTPS links on a `printify.me` domain are accepted. See the [official Printify Pop-Up Store guide](https://help.printify.com/hc/en-us/articles/12051129478417-What-is-Printify-Pop-Up-Store) for store URL and fulfillment details.
