# PokePrizePool browser notifications — staging setup

This implementation replaces Discord as the report-alert dependency with:
- D1-backed in-site notification inbox
- Read/unread state
- Per-account alert preferences for stock reports, line reports, states and retailers
- Optional browser push subscriptions using a service worker and VAPID
- Report submissions that remain successful if push delivery fails after the report is saved

## Safety: staging only

Do not run this setup against the production D1 database or production Pages environment.

## 1. Apply the staging database migration

In Cloudflare Dashboard, open **Workers & Pages → pokemon-vip-stock-app-v3 → D1/database binding** and open the database named **pokemon-vip-members-staging**. Open its SQL console and run the full contents of `migrations/0033_browser_notifications.sql`.

This migration creates the report table if staging does not have one, including the line-intelligence fields, plus notification preferences, notification inbox rows and browser push subscriptions.

Do not run `0032_report_line_intelligence.sql` separately against this fresh staging schema: migration 0033 already creates those line-report columns. Never select `pokemon-vip-members` (production).

## 2. Generate VAPID keys locally

On a computer with a current Node.js installation, open a terminal at the repository root and run:

```bash
node scripts/generate-vapid-keys.mjs
```

The script prints `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`. Keep the private key secret. Do not paste it into chat, commit it, or place it in front-end code.

## 3. Add Preview environment variables

In Cloudflare Pages project settings, configure the **Preview** environment only:
- `VAPID_PUBLIC_KEY` — public key printed by the script
- `VAPID_PRIVATE_KEY` — private key printed by the script; mark it as a secret
- `VAPID_SUBJECT` — the mailto subject printed by the script

The browser only receives the public key from `GET /api/notifications`. The private key is used server-side only.

Save the settings and trigger a fresh deployment of `feature/collector-account-login`.

## 4. Preview test checklist

1. Sign in to a staging collector account.
2. Open `/notifications.html`; confirm the inbox and preferences load.
3. Save preferences with stock reports and line reports enabled.
4. Click **Enable browser alerts** and approve the browser permission prompt.
5. Confirm a row appears in `push_subscriptions` and `notification_preferences.browser_push_enabled` is 1.
6. Submit a test stock report and verify it appears in `reports` and the in-site inbox.
7. Submit a test line report with a photo and additional notes; verify line count, who stocked, timestamp, notes and photo filenames are saved and the in-site inbox receives the line alert.
8. With browser push enabled, confirm a notification appears while the site is in the background.
9. Disable browser alerts and confirm the subscription is removed and no more push is sent to that subscription.
10. Temporarily remove/disable the VAPID private key in Preview and verify report submission still saves successfully while push delivery fails safely.

## Known behavior

- Browser push requires HTTPS and a supported browser.
- A user must explicitly enable browser notifications on each browser/device.
- Browser push is optional; the in-site inbox does not require browser permission.
- Uploaded report photos are currently attached to the report request for validation, while the existing report table records photo filenames; persistent image storage is a separate follow-up.
- This setup is not production-ready until the staging checklist passes and the same schema/configuration is planned separately for Production.
