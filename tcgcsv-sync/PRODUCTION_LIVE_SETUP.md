# Launch TCGCSV sync on the live site

This runbook deploys the TCGCSV importer directly against the **production D1 database** used by `pokeprizepool.com`. The existing staging Worker and its 113/220 progress remain separate and untouched.

## Before running the full import

Workers Paid includes 50 million D1 rows written per month before usage-based overage. This compact importer writes one product row with one preferred market price and avoids duplicate catalog copies and historical snapshots. The production Worker config sets a 500,000-row daily importer budget (about 15 million over 30 days if continuously used), reserving the remaining included allowance for the live site and other D1 work. The staging Worker retains its 50,000-row daily budget. The importer pauses at its configured budget and resumes after UTC midnight. Review the account's D1 usage dashboard before raising the budget further; this guardrail is a deliberate spending control.

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

## 5. Check the existing sync before starting anything new

The live catalog endpoint has already reported a partial import with 220 set groups registered and products/prices available, so the production sync has saved in-progress work. **For this existing partial run, deploy the Worker to restore its Cron Triggers, then check `/health`; do not POST to `/sync`.** The `/sync` endpoint begins a new run and can reset a saved cursor. The every-minute Cron Trigger resumes saved work automatically after the triggers are restored.

Only if `/health` confirms there is no saved run and this is a genuinely new import should you use the manual start procedure below. The deploy output provides the production Worker URL. If the window is Command Prompt, type `powershell` and press Enter first. Then paste these commands, using the exact Worker URL from deploy output:

```powershell
$workerUrl = (Read-Host "Paste the production Worker URL").TrimEnd("/")
$secureSecret = Read-Host "Enter the saved production SYNC_SECRET" -AsSecureString
$secretPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
$syncSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPtr)
$headers = @{ Authorization = "Bearer $syncSecret" }
Invoke-RestMethod -Method Post -Uri "$workerUrl/sync" -Headers $headers
Invoke-RestMethod -Method Get -Uri "$workerUrl/health"
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPtr)
Remove-Variable secureSecret, secretPtr, syncSecret, headers
```

The health endpoint reports progress. Cloudflare's per-minute Cron Trigger resumes saved work in the background, even after your PC sleeps or shuts down. The daily source-marker check happens at 21:00 UTC and does not re-fetch the marker every minute. Cron Trigger changes can take several minutes to propagate.

## What becomes live

The production catalog API reads the current product name, card number, set, product type and single preferred market price from `tcgcsv_products`. The Worker chooses the first available market price by preference: Normal, Holofoil, Reverse Holofoil, then other variants. Historical price snapshots are intentionally skipped to keep the initial import small. Once the Worker reports `status: "success"`, collector catalog searches and current market-price estimates can return data. Market Intelligence's prewritten mover rankings are a separate page and do not become live automatically from this sync.
