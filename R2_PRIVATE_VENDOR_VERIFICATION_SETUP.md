# Production private storage for Vendor+ event seller verification

This feature stores government ID front/back images and a selfie. These are sensitive identity documents and MUST use a dedicated private R2 bucket, not the public `VENDOR_MEDIA` bucket.

## One-time production setup

1. Open Cloudflare Dashboard → **R2 Object Storage**.
2. Create a dedicated bucket named `pokemon-vip-event-verification-private-production`.
3. Keep this bucket private. Do not enable public access, a public custom domain, or public object URLs.
4. Open **Workers & Pages → pokemon-vip-stock-app-v3 → Settings → Bindings**.
5. Add an **R2 bucket binding**:
   - Variable name: `VENDOR_VERIFICATION_PRIVATE`
   - Bucket: `pokemon-vip-event-verification-private-production`
6. Save the binding and deploy the production Pages project so the Functions can access it.
7. Do not put identity files in `VENDOR_MEDIA`; its image endpoint is designed for public site media and is not suitable for IDs or selfies.

## Access and retention

- Only a signed-in account with `is_admin=1` can request a pending verification document through `/api/vendor-event-sales-verification?document=...`.
- Document responses are private, no-store, and sent with `X-Content-Type-Options: nosniff`.
- Uploads accept only JPEG, PNG, WebP, or AVIF images, with signature validation and an 8 MB per-file limit.
- After an admin approves or rejects a pending request, the three objects are deleted and the D1 row retains only the decision, review note, and timestamps.
- Never email document links or add identity images to public event media, shop media, or public image URLs.

## User-visible rules

Anyone may submit an event through the existing event submission form. Only active Vendor+ members whose identity verification status is `approved` can create or activate ticket, table, or booth sales. Stripe Connect onboarding remains a separate step. Admins retain their existing override.
