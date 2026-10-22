# PokePrizePool Community Feed — production deployment and test plan

This release targets the live PokePrizePool site and its production D1 database. No staging deployment is part of this rollout.

## Deployment order

**The database migration must be applied before merging the pull request into `main`.** The site navigation and profile Posts tab will be deployed with the code, so the new tables need to exist when that deployment becomes live.

### 1. Open the production D1 database

In Cloudflare, go to **Workers & Pages → D1 SQL Database → `pokemon-vip-members`**. Verify the database name carefully. Do not choose `pokemon-vip-members-staging`.

### 2. Run the production migration

Open `production-migrations/002_collector_social_feed.sql` in this pull request. Copy the complete file and execute it in the SQL console for **`pokemon-vip-members`**.

This adds four tables for social posts, likes, comments, and reports. It does not alter existing accounts, collections, wishlists, shop listings, follows, or trades.

### 3. Verify the tables

Run:

```sql
SELECT name
FROM sqlite_master
WHERE type = 'table'
  AND name IN (
    'collector_posts',
    'collector_post_likes',
    'collector_post_comments',
    'collector_post_reports'
  )
ORDER BY name;
```

Expected: four rows, one for each table.

### 4. Deploy the code

After the SQL tables are present, merge PR #19 into `main`. The existing Cloudflare Pages production deployment should then pick up the code. Verify the deployment has completed before beginning functional tests.

### 5. Test on the live site

Open [https://pokeprizepool.com](https://pokeprizepool.com) and test with two member accounts.

1. Sign in and open **My Profile**. Confirm the new Posts tab appears alongside Collection, Wishlist, and Shop.
2. Publish a text-only post and confirm it appears on both the profile and Community Feed.
3. Upload a small test image. Confirm it displays after refreshing.
4. Like a post, add a comment, refresh, and confirm saved counts/state persist.
5. Sign in as a second account and confirm it can view public posts, comment, like, and report a post—but cannot delete another member’s post.
6. Test **For You**, **Following**, and **Latest**. The Following feed needs a member who follows another member.
7. Confirm the report appears in `collector_post_reports`.
8. Recheck Collection, Wishlist, Shop, trades/offers, follows, and blocking.

Use a clearly labelled test post/photo and remove them after checks. Test only the account permissions you control.

## Current scope

Member post and comment deletion, likes, comments, and post reporting are included. Reports are saved for later review; a dedicated administrator moderation dashboard is not part of this first release. The live site should be considered under test until the checklist passes.
