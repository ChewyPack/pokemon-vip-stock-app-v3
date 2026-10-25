# Launch TCGCSV sync on the live site

This runbook deploys the TCGCSV importer directly against the **production D1 database** used by `pokeprizepool.com`. The existing staging Worker and its 113/220 progress remain separate and untouched.

## Before running the full import

Workers Paid includes 50 million D1 rows written per month before usage-based overage. This compact importer writes one product row with one preferred market price and avoids duplicate catalog copies and historical snapshots. The production Worker config sets a 500,000-row daily importer budget (about 15 million over 30 days if continuously used), reserving the remaining included allowance for the live site and other D1 work. The staging Worker retains its 50,000-row daily budget. The importer pauses at its configured budget and resumes after UTC midnight. Review the account's D1 usage dashboard before raising the budget further; this guardrail is a deliberate spending control.

The production config includes a minute trigger to resume saved work and two daily UTC triggers (21:00 and 22:00). The Worker checks the scheduled time in America/New_York and only runs the daily TCGCSV source check at 5:00 PM Eastern. Using both UTC triggers accounts for daylight-saving time changes. Deploy the production config to restore these triggers if they were deleted in the Cloudflare dashboard.

## 1. Pause the old staging importer

In Cloudflare Dashboard, open **Workers & Pages → pokeprizepool-tcgcsv-sync-staging → Settings → Triggers** and disable/remove its every-minute Cron Trigger while the live import runs. Its old full importer can otherwise consume the same account-wide Free D1 write allowance. Do not delete the staging database or its saved progress.

## 2. Apply the required production schema patch

From the repository root, with Wrangler authenticated:

```cmd
npx wrangler login
npx wrangler d1 execute pokemon-vip-members --remote --file=production-migrations/008_compact_tcgcsv_catalog.sql
```

This adds compact current-price fields to products and daily resume-budget fields to the progress cursor. It does not import products or delete catalog data. Run it only against the production database name shown in the command.

## 3. Create the production Worker configuration

In the repository root:

```cmd
npx wrangler d1 list
copy tcgcsv-sync\wrangler.production.example.toml tcgcsv-sync\wrangler.production.toml
```

The template is prefilled with the production D1 ID you verified: `4427e96c-d1f1-4f42-b863-94e303a4b7d9`. It names `pokemon-vip-members` explicitly. Do not replace it with the staging database ID. The real deployment config is ignored by Git so its settings are not accidentally committed.

## 4. Deploy the production Worker and set its secret

```powershell
cd tcgcsv-sync
npx wrangler deploy --config wrangler.production.toml
npx wrangler secret put SYNC_SECRET --config wrangler.production.toml
```

When prompted, enter a new long random secret and save it somewhere secure. Do not commit it or send it in chat. Keep this production secret separate from the staging Worker's secret.

## 5. Verify the live catalog and use the price-only sync

The current production database check showed 220 registered groups and 32,881 product rows, with 30,663 rows containing a market price. The Worker health endpoint reports `status: "success"` and no error, with no saved import cursor. These values are consistent with the initial import having completed, though they do not independently prove the upstream catalog has no additional products.

Deploy the latest `tcgcsv-sync/worker.js` from `main` before relying on the new sync behavior. In this version, **POST `/sync` starts a resumable price-only refresh**: it fetches each existing group's prices and updates only `market_price` and `market_price_subtype` on existing product rows. It does not re-import product names, card metadata, images, or sets. The scheduled daily source check also starts this price-only refresh when TCGCSV's source marker changes.

Use `/catalog-sync` once when new products must be discovered, including sealed products. It reads each group's product list and prices, inserts newly available products, and upserts the existing product metadata and prices. This is more work than the routine price-only refresh.

Use `/sync` for routine market-price refreshes. It updates market price, preferred price subtype, and the freshness marker on existing products; it does not rewrite card names, card numbers, images, rarity, or product type. Both POST endpoints require the production `SYNC_SECRET` as a bearer token.

After deploying, check `/health`. During a catalog pass, watch `progress`; during a price refresh, watch `price_progress` and the log message `Refreshing TCGCSV prices for group`. The minute Cron Trigger resumes saved work, and the daily source check runs at 5:00 PM America/New_York (using the matching 21:00 or 22:00 UTC trigger).

## What becomes live

The production catalog API reads the current product name, card number, set, product type and single preferred market price from `tcgcsv_products`. The Worker chooses the first available market price by preference: Normal, Holofoil, Reverse Holofoil, then other variants. Historical price snapshots are intentionally skipped to keep the initial import small. Once the Worker reports `status: "success"`, collector catalog searches and current market-price estimates can return data. Market Intelligence's prewritten mover rankings are a separate page and do not become live automatically from this sync.
