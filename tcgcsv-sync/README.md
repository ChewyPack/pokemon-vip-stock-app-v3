# PokePrizePool TCGCSV sync (staging)

This Worker downloads only the Pokémon category (TCGplayer category ID 3), stores products and market prices in the **staging D1 database**, and runs daily. User-facing pages search the saved catalog; they must not request TCGCSV directly.

## Safety first

- Do not point this Worker at the production D1 database.
- Apply the collector schema and TCGCSV catalog schema to `pokemon-vip-members-staging` before the first sync.
- Keep the Worker name ending in `-staging` and use the staging D1 ID only.

## Deploy

From the `tcgcsv-sync` directory in a terminal with Wrangler installed and authenticated:

```sh
npx wrangler secret put SYNC_SECRET
npx wrangler deploy
```

When prompted for `SYNC_SECRET`, enter a long random secret and save it somewhere secure. Do not commit it to GitHub or share it in chat.

The Worker is scheduled for 09:00 UTC daily. It checks `https://tcgcsv.com/last-updated.txt` first and skips unchanged source builds. Requests use the custom User-Agent `PokePrizePoolMarket/1.0.0` and a 100 ms delay.

## Resumable import

Each Worker invocation processes one Pokémon group/set and then securely schedules the next invocation. This avoids exceeding Cloudflare's per-invocation subrequest limit. Progress is saved in `tcgcsv_sync_progress` and is visible at `/health`. The catalog is published only after all groups complete successfully.

Start a sync with a POST to `/sync` using the Authorization bearer secret. Check progress at `/health`. Never expose the secret in browser code.

## Current scope and limitations

- Imports Pokémon product catalog records, sets/groups, and per-variant TCGplayer market prices.
- Stores immutable price snapshots per TCGCSV source build in `tcgcsv_price_history` for later trend charts.
- Card/single vs sealed classification is inferred from TCGCSV extended fields (card number or rarity means single); review edge cases as part of testing.
- TCGCSV does not supply a complete graded-slab catalog. Graded items should reference their underlying raw card and store grading company/grade separately in PokePrizePool.
- No price archive is downloaded.
