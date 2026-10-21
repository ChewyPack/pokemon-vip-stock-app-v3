# Production R2 image storage setup

The production site uses the existing `VENDOR_MEDIA` binding for vendor logos/covers, stock-report photos, and collector profile photos. The binding must point to the production bucket; never attach the staging bucket to production.

1. In Cloudflare Dashboard, open **R2 Object Storage**.
2. Create a dedicated bucket named `pokemon-vip-vendor-media-production` (if it does not already exist).
3. Open **Workers & Pages → pokemon-vip-stock-app-v3 → Settings → Bindings**.
4. Add an **R2 bucket binding** with variable name exactly `VENDOR_MEDIA` and select `pokemon-vip-vendor-media-production`.
5. Save the binding and redeploy the production Pages project so Functions can access it.
6. After the deployment is live, open `https://pokeprizepool.com/account.html`, sign in, and re-upload the profile photo and cover photo. Choose an image, wait for the upload-success message, then click **Save profile**. The collector profile page also supports changing these images.
7. Test one image first. If uploads report that storage is not configured, verify the production binding name and redeploy.

Upload API accepts authenticated account sessions and JPEG, PNG, WebP, or AVIF images up to 5 MB after browser-side resize. Objects are stored under `collectors/<account-id>/<avatar-or-cover>/<random-id>.<extension>`; only generated image keys are served through `/api/vendor/image`. Vendor shop images and report photos use other prefixes in the same bucket.

This configuration does not change the D1 database, passwords, follows, or Stripe subscriptions.
