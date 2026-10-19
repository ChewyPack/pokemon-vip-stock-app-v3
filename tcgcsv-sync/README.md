# PokePrizePool TCGCSV sync (staging)

This Worker downloads only the Pokémon category (TCGplayer category ID 3), stores products and market prices in the **staging D1 database**, and runs daily. User-facing pages search the saved catalog; they must not request TCGCSV directly.

## Safety first

- Do not point this Worker at the production D1 database.
- Apply the existing collector schema migrations first if they have not already been applied, then apply `migrations/tcgcsv_catalog.sql` to `pokemon-vip-members-staging` before the first sync.
- In `wrangler.toml`, replace `REPLACE_WITH_STAGING_D1_DATABASE_ID` with the ID for the staging database only.
- Keep the Worker name ending in `-staging`.

## Deploy

From the `tcgcsv-sync` directory in a terminal with Wrangler installed and authenticated:

```sh
npx wrangler secret put SYNC_SECRET
npx wrangler deploy
```

When prompted for `SYNC_SECRET`, enter a long random secret and save it somewhere secure. Do not commit it to GitHub.

The Worker is scheduled for 09:00 UTC every day. It first checks `https://tcgcsv.com/last-updated.txt`; if the timestamp matches the last successful sync, it skips all catalog requests. During a sync, every TCGCSV request includes the custom User-Agent `PokePrizePoolMarket/1.0.0` and is followed by a 100 ms delay. It syncs Pokémon groups only, not the full archive.

## Initial sync and status

After deployment, run the initial sync once using the Worker URL:

```sh
curl -X POST "https://pokeprizepool-tcgcsv-sync-staging.<your-account-subdomain>.workers.dev/sync" -H "Authorization: Bearer <your-SYNC_SECRET>"
```

Check status with:

```sh
curl "https://pokeprizepool-tcgcsv-sync-staging.<your-account-subdomain>.workers.dev/health"
```

Do not share the secret or put it in browser-side code.

## Current scope and limitations

- Imports Pokémon product catalog records, sets/groups, and per-variant TCGplayer market prices.
- Stores immutable price snapshots per TCGCSV source build in `tcgcsv_price_history` for later trend charts.
- Card/single vs sealed classification is inferred from TCGCSV extended fields (card number or rarity means single); review edge cases as part of testing.
- TCGCSV does not supply a complete graded-slab catalog. Graded items should reference their underlying raw card and store grading company/grade separately in PokePrizePool.
- No price archive is downloaded.
