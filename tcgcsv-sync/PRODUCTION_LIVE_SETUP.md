# Launch TCGCSV sync on the live site

This runbook deploys the TCGCSV importer directly against the **production D1 database** used by `pokeprizepool.com`. The existing staging Worker and its 113/220 progress remain separate and untouched.

## Before running the full import

Cloudflare Workers Free limits D1 to 100,000 rows written per day. A full catalog import can exceed that. Upgrade this Cloudflare account to **Workers Paid** first if you need the import to finish without waiting for daily resets. Cloudflare currently includes 50 million D1 row writes per month on Workers Paid; writes above that are $1 per million, and usage is billable. The plan has a $5/month minimum. Check current usage in Cloudflare Billing before starting.

## 1. Apply the required production schema patch

From the repository root, with Wrangler authenticated:

```powershell
npx wrangler login
npx wrangler d1 execute pokemon-vip-members --remote --file=production-migrations/007_tcgcsv_price_history_market_price.sql
```

This adds the market-price field to price history that the current production baseline schema is missing. Do not run this command against the staging database.

## 2. Create the production Worker configuration

In the repository root:

```powershell
npx wrangler d1 list
copy tcgcsv-sync\wrangler.production.example.toml tcgcsv-sync\wrangler.production.toml
notepad tcgcsv-sync\wrangler.production.toml
```

In Notepad, replace `REPLACE_WITH_PRODUCTION_D1_ID_FROM_WRANGLER_D1_LIST` with the ID beside the exact database name `pokemon-vip-members`. Keep `database_name = "pokemon-vip-members"`. Do not use the ID for `pokemon-vip-members-staging`. Save the file.

## 3. Deploy the production Worker and set its secret

```powershell
cd tcgcsv-sync
npx wrangler deploy --config wrangler.production.toml
npx wrangler secret put SYNC_SECRET --config wrangler.production.toml
```

When prompted, enter a new long random secret and save it somewhere secure. Do not commit it or send it in chat. Keep this production secret separate from the staging Worker's secret.

## 4. Start the first live sync immediately

The deploy output provides the production Worker URL. In PowerShell, use that exact URL and the secret you just saved:

```powershell
$workerUrl = Read-Host "Paste the production Worker URL from deploy output"
$workerUrl = $workerUrl.TrimEnd("/")
$syncSecret = Read-Host "Enter the saved production SYNC_SECRET"
$headers = @{ Authorization = "Bearer $syncSecret" }
Invoke-RestMethod -Method Post -Uri "$workerUrl/sync" -Headers $headers
Invoke-RestMethod -Method Get -Uri "$workerUrl/health"
Remove-Variable syncSecret, headers
```

The POST should return an accepted/started sync (or report that the source is already up to date). The health endpoint reports progress. Cloudflare's per-minute trigger resumes a saved import in the background, even after your PC sleeps or shuts down. The daily source-marker check happens at 21:00 UTC and does not re-fetch the marker every minute.

## What becomes live

The production catalog API already reads `tcgcsv_groups`, `tcgcsv_products`, `tcgcsv_prices`, and `tcgcsv_price_history` from the production `DB` binding. Once the Worker successfully publishes the first catalog, collector card/sealed catalog search, TCGplayer market-price estimates, and saved price history can return data. Market Intelligence's prewritten mover rankings are a separate page and do not become live automatically from this sync.
