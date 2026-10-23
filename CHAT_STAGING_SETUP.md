# PokePrizePool Community Chat — staging setup

This feature is for the `feature/collector-account-login` staging branch only. Do not attach these resources to the production Pages project or production database.

## What was added

- `chat.html`: responsive channel-based community chat page.
- `functions/api/chat/channels.js`: authenticated channel list.
- `functions/api/chat/messages.js`: persistent message history, sending, deletion, and rate limiting.
- `functions/api/chat/socket.js`: authenticated WebSocket handshake.
- `functions/_lib/chat.js`: uses the existing `collector_session` login cookie and broadcasts events.
- `workers/chat-realtime/`: Cloudflare Durable Object WebSocket room for live message delivery.
- `migrations/staging_community_chat.sql`: channels and message tables.

All registered accounts can read and post in chat; VIP status is not required. A logged-in session is required. The initial channels are General, Restocks & Finds, Market Talk, Trades & Collections, and Help Desk.

## Required setup before the first test

The GitHub code alone cannot create Cloudflare bindings or run a D1 migration. Complete these steps in staging only.

### 1. Apply the D1 migration

In a terminal opened at the repository root, run:

```powershell
npx wrangler d1 execute pokemon-vip-members-staging --remote --file=migrations/staging_community_chat.sql
```

If Wrangler asks you to log in, run `npx wrangler login` and repeat the command. Verify the command targets **pokemon-vip-members-staging**. Do not substitute the production database.

### 2. Deploy the real-time Durable Object Worker

From the repository root:

```powershell
npx wrangler deploy --config workers/chat-realtime/wrangler.toml
```

This deploys a separate staging-only Worker named `pokeprizepool-chat-realtime-staging`. Its public URL deliberately does not expose chat endpoints; the Pages app accesses the Durable Object through a binding.

### 3. Set the same internal secret in both staging environments

Generate a strong random value locally in PowerShell:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the generated value temporarily. Do not commit it to GitHub or paste it into chat.

Set it as a secret for the real-time Worker:

```powershell
npx wrangler secret put CHAT_INTERNAL_SECRET --config workers/chat-realtime/wrangler.toml
```

When prompted, paste the generated value.

In Cloudflare Dashboard, open **Workers & Pages → the staging Pages project for pokemon-vip-stock-app-v3 → Settings → Variables and Secrets**. Under the **Preview** environment, add a secret named `CHAT_INTERNAL_SECRET` with the exact same value. Do not add it to the production environment.

### 4. Bind the Durable Object to the staging Pages project

In the staging Pages project settings, open **Bindings** and add a **Durable Object namespace** binding:

- Variable name: `CHAT_ROOM`
- Namespace / class: `ChatRoom` from `pokeprizepool-chat-realtime-staging`

Choose the deployed staging Worker/class, not any production resource. Save the binding and trigger a new deployment of the `feature/collector-account-login` preview so Pages Functions receive it.

If the dashboard does not offer the deployed class as a binding choice, stop and check that the Worker deployment succeeded and that both resources are in the same Cloudflare account. Do not route production to staging as a workaround.

## Test checklist

1. Open the staging preview URL and visit `/chat.html`.
2. While signed out, confirm chat asks you to sign in.
3. Sign in with a registered staging account; confirm the channels and message history load.
4. Open the same staging page in a second browser/profile signed in as another registered account.
5. Send a message from the first window. It should appear in the second window without refreshing.
6. Switch channels and verify each channel retains its own history.
7. Delete a message you sent and verify the deletion appears in both windows.
8. Send 15 messages in one minute and verify the rate limit prevents additional posts.
9. Confirm the production domain and production D1 database were not changed.

## Notes

- Messages are text-only in this first version; each message is limited to 1,200 characters.
- The API limits each account to 15 messages per minute.
- Message deletion is available to the author and accounts flagged as administrators.
- The chat uses the existing account login/session system. It does not grant or change VIP, vendor, or organizer permissions.
- The UI can load saved history before real-time binding setup, but posting and WebSocket connection require the staging binding and matching secret.
