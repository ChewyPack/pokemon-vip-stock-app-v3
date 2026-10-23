# PokePrizePool store backend (staging-first)

Cloudflare Pages Functions + D1 + Stripe Checkout (one-time `mode=payment`, never subscriptions).
Everything is additive: new `store_*` tables and new `/api/store/*` routes. Nothing existing is modified.

## Assumptions (I could not inspect your repo)
- Pages Functions with a D1 binding named `DB`. If your binding or `functions/` layout differs, rename in one place.
- Admin auth is **default deny**. Wire `requireAdmin()` in `functions/api/store/_lib.js` to your existing verified-admin check.
  For staging only, setting `STORE_ENV=staging` plus `STORE_STAGING_ADMIN_TOKEN` enables an `x-store-admin-token` header. Never set these in production.

## Install (on your feature branch)
1. Copy `functions/api/store/` into the repo's `functions/api/store/` and `migrations/0100_store.sql` into your migrations folder (check numbering).
2. Staging migration only:
   `npx wrangler d1 migrations apply <STAGING_DB_NAME> --remote --env staging`
   (or `npx wrangler d1 execute <STAGING_DB_NAME> --remote --env staging --file=migrations/0100_store.sql`). It is repeatable (`IF NOT EXISTS`). Do not run against production until approved.
3. Staging environment variables / secrets:
   - `STRIPE_SECRET_KEY` (test mode `sk_test_...`)
   - `STRIPE_STORE_WEBHOOK_SECRET` (signing secret of the new store endpoint)
   - `STORE_PUBLIC_URL` (the staging origin, no trailing slash)
   - `STORE_SHIPPING_OPTIONS` e.g. `[{"name":"Standard","amountCents":0}]` — you must set real rates; checkout refuses without them
   - `STORE_TAX_MODE` = `stripe_automatic` (requires Stripe Tax enabled) or `none_confirmed` (only if you confirmed no tax is due)
   - optional: `STORE_SHIP_COUNTRIES` (default `US`), `STORE_TAX_CODE`
4. In the Stripe **test** dashboard add a webhook endpoint `https://<staging>/api/store/webhook` for events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`.
   Use its signing secret above. Leave the membership webhook alone; store events carry `metadata.ppp_store_order_id`, anything else is ignored.

## Endpoints
- `GET /api/store/products` — search, category, availability, price range, sort, pagination (active products only)
- `POST /api/store/checkout` — `{items:[{productId,quantity}], email?}` → `{url}` to redirect to Stripe
- `GET /api/store/order?n=<order number>&t=<token>` — confirmation data (status comes from the webhook, not the success URL)
- `POST /api/store/webhook` — signature-verified, idempotent
- `GET/POST/PATCH /api/store/admin/products` and `GET/PATCH /api/store/admin/orders` — admin only, audited

## How the safety rules are met
- Prices, stock and totals are read from D1; the client sends only product ids and quantities.
- Stock is reserved atomically at checkout (D1 batch + `CHECK (inventory >= 0)`), so concurrent buyers cannot oversell; expired/failed sessions return stock exactly once.
- Orders become `paid` only from a verified webhook. If Stripe's subtotal disagrees with ours, or payment arrives after expiry, the order is flagged `review`.
- Duplicate webhook deliveries are ignored by event id; a failed handler removes the id so Stripe retries.

## Not done yet
- Frontend wiring: connect the prototype's catalog/cart to these endpoints and add `/store/order` confirmation page.
- Image upload (admin accepts https image URLs; R2 upload not built).
- Transactional email, rate limiting (add a Cloudflare rate-limit rule on `/api/store/checkout`), account order history, VIP discount.
- Not run against real Cloudflare or Stripe: syntax-checked, SQL and oversell/restock logic tested in SQLite only.
