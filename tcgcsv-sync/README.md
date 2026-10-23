# PokePrizePool TCGCSV sync (staging)

This Worker downloads only the Pokémon category (TCGplayer category ID 3), stores products and market prices in the **staging D1 database**, and runs daily. User-facing pages search the saved catalog; they must not request TCGCSV directly.

## Safety first

- Do not point this Worker at the production D1 database.
- Apply the collector schema and TCGCSV catalog schema to `pokemon-vip-members-staging` before the first sync.
- Keep the Worker name ending in `-staging` and use the staging D1 ID only.

## Deploy

This is a Cloudflare Worker, so after deployment its Cron Triggers run in Cloudflare and do not require your PC to stay awake. Your PC only needs to be awake for the one-time setup/deployment or to manually start/check a sync.

Before deploying, apply `migrations/tcgcsv_catalog.sql` and the collector/account schema migrations required by your staging app to the **staging** D1 database. Confirm that the binding below still points at `pokemon-vip-members-staging`.

From the repository root, open a terminal and run these commands. If Wrangler is not already authenticated, run `npx wrangler login` and complete the browser sign-in.

```powershell
cd tcgcsv-sync
npx wrangler deploy
npx wrangler secret put SYNC_SECRET
```

Deploy first so Wrangler creates the staging Worker and its Cron Triggers; then add the secret. When prompted for `SYNC_SECRET`, use a long random value and save it somewhere secure. Do not commit it to GitHub or share it in chat.

To start the first import immediately (instead of waiting for the 21:00 UTC trigger), use PowerShell and the Worker URL printed by the deploy command:

```powershell
$workerUrl = Read-Host "Worker URL from the deploy output"
$workerUrl = $workerUrl.TrimEnd("/")
$syncSecret = Read-Host "Enter the saved SYNC_SECRET"
$headers = @{ Authorization = "Bearer $syncSecret" }
Invoke-RestMethod -Method Post -Uri "$workerUrl/sync" -Headers $headers
Invoke-RestMethod -Method Get -Uri "$workerUrl/health"
Remove-Variable syncSecret, headers
```

The manual call only starts the import. Cloudflare's minute trigger continues processing the saved groups after the terminal closes.

The Worker checks `https://tcgcsv.com/last-updated.txt` at 21:00 UTC once per day, after TCGCSV's usual daily update window, and skips unchanged source builds. A separate every-minute trigger only advances a sync already in progress; it does not poll TCGCSV while idle. Imports can therefore resume unattended until every Pokémon group has been processed. Requests use the custom User-Agent `PokePrizePoolMarket/1.0.0` and a 100 ms delay.

## Resumable import

Each Worker invocation processes one Pokémon group/set and then securely schedules the next invocation. This avoids exceeding Cloudflare's per-invocation subrequest limit. Progress is saved in `tcgcsv_sync_progress` and is visible at `/health`. The catalog is published only after all groups complete successfully.

Start a sync with a POST to `/sync` using the Authorization bearer secret. Check progress at `/health`. Never expose the secret in browser code.

## Current scope and limitations

- Imports Pokémon product catalog records, sets/groups, and per-variant TCGplayer market prices.
- Stores immutable price snapshots per TCGCSV source build in `tcgcsv_price_history` for later trend charts.
- Card/single vs sealed classification is inferred from TCGCSV extended fields (card number or rarity means single); review edge cases as part of testing.
- TCGCSV does not supply a complete graded-slab catalog. Graded items should reference their underlying raw card and store grading company/grade separately in PokePrizePool.
- No price archive is downloaded.
