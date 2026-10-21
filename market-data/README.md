# PokePrizePool Market Data Archive

## Purpose

Build a durable, source-dated Pokémon TCG pricing archive for Market Intelligence. This directory documents the archive contract before any live data is published. Do not treat the existing hand-maintained Market Intelligence page as a live feed.

## Initial source

- Provider: TCGCSV, which republishes TCGplayer catalog and price data.
- Pokémon category: `3` (English Pokémon).
- Source freshness: check `https://tcgcsv.com/last-updated.txt` before syncing. TCGCSV updates once daily; do not poll more frequently than once every 24 hours.
- Price endpoint pattern: `https://tcgcsv.com/tcgplayer/{categoryId}/{groupId}/prices`
- Product endpoint pattern: `https://tcgcsv.com/tcgplayer/{categoryId}/{groupId}/products`
- Group endpoint: `https://tcgcsv.com/tcgplayer/3/groups`
- Historical source archive begins 2024-02-08: `https://tcgcsv.com/archive/tcgplayer/prices-YYYY-MM-DD.ppmd.7z`

## Required snapshot fields

Each observed price row must retain:

- `snapshot_date`: date represented by the source file, YYYY-MM-DD
- `source`: `tcgcsv_tcgplayer`
- `source_updated_at`: timestamp from TCGCSV's last-updated marker, when available
- `category_id`, `group_id`, `product_id`
- `product_name`, `group_name` when catalog data resolves them
- `sub_type_name`: keep Normal, Holofoil, Reverse Holofoil, and other source variants separate
- `market_price`, `low_price`, `mid_price`, `high_price`, `direct_low_price`
- `currency`: USD
- `data_status`: observed, missing, or stale; never replace missing values with zero

Use a composite identity based on source + category + product ID + subtype/variant + snapshot date. TCGCSV warns that product IDs are not safe as a primary key on their own.

## Category coverage

1. Singles: catalogued individual cards and each source subtype separately.
2. Sealed: catalogued sealed boxes, packs, tins, ETBs, and collections. Classify using product metadata and maintain a reviewable mapping; do not assume every product name is classified correctly.
3. Slabs: do not infer graded-card prices from raw TCGplayer prices. Graded market prices and grading-company population counts require a separate, explicitly sourced dataset.

## Historical comparisons

- Calculate 7-day and 30-day change only when both endpoint observations exist for the same exact product/variant and the price values are valid.
- Label the dates used in every comparison.
- Do not interpolate missing observations or report missing data as zero.
- Retain source date separately from ingestion date.
- The TCGCSV archive can provide historical price files from 2024-02-08 onward, but historical product matching and subtype coverage must be validated before publishing calculations.

## Storage and publication rules

- Keep raw source records immutable; derived rankings and market signals are separate outputs.
- Prefer durable object storage (Cloudflare R2) for daily snapshots rather than committing an indefinitely growing archive to the website repository.
- Import and validate on staging first. Production `pokeprizepool.com` and the production D1 database must not be changed as part of this work.
- Do not show automated/live status on the public Market Intelligence page until the importer has run successfully, data is persisted, and the page reads from that persisted dataset.
- Include a source attribution to TCGplayer via TCGCSV and the actual snapshot date on published prices.

## Operational constraints from TCGCSV

- Use a descriptive User-Agent.
- Check the last-updated marker before a full sync and sync no more than once per day.
- Be considerate of request volume; throttle requests and avoid fetching the same group repeatedly.
- TCGCSV has restrictive browser CORS, so ingestion must run server-side.
