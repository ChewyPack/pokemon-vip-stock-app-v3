# Staging vendor image storage setup

Do this before testing uploads. Do not attach the bucket to production yet.

1. In Cloudflare Dashboard, open **R2 Object Storage** and create a bucket named `pokemon-vip-vendor-media-staging`.
2. Open **Workers & Pages** → the staging Pages project for `pokemon-vip-stock-app-v3` → **Settings** → **Bindings**.
3. Add an **R2 bucket binding** with variable name `VENDOR_MEDIA` and select `pokemon-vip-vendor-media-staging`.
4. Save and redeploy the staging project so the binding is available to Functions.
5. Run `migrations/staging_vendor_storefront.sql` against **pokemon-vip-members-staging**, only after `migrations/staging_vendor_tools.sql` has successfully created the vendor tables.
6. The upload API accepts JPEG, PNG, WebP, and AVIF files up to 5 MB. It uses generated object keys; vendors do not type image URLs.

The public image endpoint serves only generated keys under `vendors/<account-id>/`. It does not accept arbitrary remote URLs.
