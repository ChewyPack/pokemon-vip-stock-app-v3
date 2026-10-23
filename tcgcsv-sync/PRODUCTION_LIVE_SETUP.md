# Launch TCGCSV sync on the live site

This runbook deploys the TCGCSV importer directly against the **production D1 database** used by `pokeprizepool.com`. The existing staging Worker and its 113/220 progress remain separate and untouched.

## Before running the full import

The Workers Free plan allows 100,000 D1 rows written per UTC day across the account. This compact importer writes one product row with a single preferred market price, avoids duplicate staging-table copies and price-history snapshots, and pauses at 50,000 measured importer row writes for the day to reserve headroom for the live site. It resumes automatically after midnight UTC. The initial import may take multiple days. This is a safety budget, not a guarantee against unusually high write activity from the website or another Worker; pause the old staging sync first. Workers Paid is optional if you later decide you need the import completed faster.

## 1. Apply the required production schema patch

From the repository root, with Wrangler authenticated:

```powershell
npx wrangler login
npx wrangler d1 execute pokemon-vip-members --remote --file=production-migrations/008_compact_tcgcsv_catalog.sql
```

This adds compact current-price fields to products and daily resume-budget fields to the progress cursor. It does not import products or delete catalog data. Run it only against the production database name shown in the command.

## 2. Pause the old staging importer

In Cloudflare Dashboard, open **Workers & Pages → pokeprizepool-tcgcsv-sync-staging → Settings → Triggers** and disable/remove its every-minute Cron Trigger while the live import runs. Its old full importer can otherwise consume the same account-wide Free D1 write allowance. Do not delete the staging database or its saved progress.

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

## 5. Start the first live sync immediately

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

The production catalog API reads the current product name, card number, set, product type and single preferred market price from `tcgcsv_products`. The Worker chooses the first available market price by preference: Normal, Holofoil, Reverse Holofoil, then other variants. Historical price snapshots are intentionally skipped to keep the initial import small. Once the Worker reports `status: "success"`, collector catalog searches and current market-price estimates can return data. Market Intelligence's prewritten mover rankings are a separate page and do not become live automatically from this sync.
