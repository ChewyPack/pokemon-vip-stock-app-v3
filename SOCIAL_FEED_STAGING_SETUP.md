# Collector social feed — staging setup

This feature is intended for a Cloudflare Pages preview deployment only until it has been tested. **Do not run the social-feed migration against the production D1 database.**

## 1. Confirm the staging bindings

In Cloudflare, open **Workers & Pages → pokemon-vip-stock-app-v3 → Settings → Bindings** for the preview environment used by `feature/collector-social-feed`.

- Confirm `DB` points to `pokemon-vip-members-staging`.
- Confirm `VENDOR_MEDIA` points to a **staging** R2 bucket, not the production bucket.

## 2. Confirm existing collector tables

Open the D1 console for **pokemon-vip-members-staging** and run:

```sql
SELECT name
FROM sqlite_master
WHERE type = 'table'
  AND name IN ('accounts', 'collector_profiles', 'collector_follows', 'collector_blocks');
```

The existing collector-account, profile, follow, and block setup should already be present. Do not change the production database.

## 3. Apply the new migration to staging

Open `migrations/staging_collector_social_feed.sql` in this branch, copy the entire SQL file, and execute it in the console for **pokemon-vip-members-staging only**.

Verify that the new tables exist:

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

Expected: all four tables.

## 4. Preview test checklist

Use the preview URL for this feature branch; do not use `pokeprizepool.com` for initial testing.

1. Sign in with a staging collector account and open **My Profile**. The new **Posts** tab should appear alongside Collection, Wishlist, and Shop.
2. Create a text-only status post and verify it appears on your profile and on **Community Feed**.
3. Upload a small test image and confirm that it renders in the post.
4. Like a post, add a comment, refresh, and confirm counts and state remain saved.
5. Visit another staging member's profile and confirm you can read public posts and cannot delete another member's post.
6. Test For You, Latest, and Following feeds. Following requires a signed-in account that follows another staging profile.
7. Report a test post from a second staging account, and verify a row appears in `collector_post_reports`.
8. Verify existing Collection, Wishlist, Shop, messaging/trades, following, and blocking still work.

## Scope note

Post reports are saved in the database, and members can delete their own posts and comments. A dedicated administrator moderation dashboard and post-report review workflow are not part of this first implementation.
