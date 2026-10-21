# PokePrizePool Community Chat — production setup

This is a separate production setup. Do not reuse the staging Worker, staging Durable Object namespace, staging secret, or staging D1 database.

## Safety boundary

- Production website: `https://pokeprizepool.com/chat.html`
- Production Pages project: `pokemon-vip-stock-app-v3`
- Production real-time Worker: `pokeprizepool-chat-realtime-production`
- Staging real-time Worker remains `pokeprizepool-chat-realtime-staging`
- The real-time Worker uses a Durable Object for WebSocket delivery. Chat messages remain stored in the existing Pages D1 binding; this setup does not run a D1 migration or modify membership/Stripe tables.

## 1. Deploy the production Worker

From the repository root, after reviewing this branch and merging its code when ready:

```powershell
npx wrangler deploy --config workers/chat-realtime/wrangler.production.toml
```

This creates a separate Worker and Durable Object namespace. It does not alter the staging Worker.

## 2. Set a production-only internal secret

Generate a secret locally:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Do not commit the secret or paste it into chat. Set it on the production Worker:

```powershell
npx wrangler secret put CHAT_INTERNAL_SECRET --config workers/chat-realtime/wrangler.production.toml
```

Paste the generated value when prompted.

In Cloudflare Dashboard, open **Workers & Pages → pokemon-vip-stock-app-v3 → Settings → Variables and Secrets**. Under **Production** only, add secret `CHAT_INTERNAL_SECRET` with that exact value. Keep the existing Preview secret unchanged.

## 3. Bind the production Pages project

In the same production Pages project, open **Settings → Bindings** and add a Durable Object namespace binding:

- Variable name: `CHAT_ROOM`
- Durable Object class: `ChatRoom`
- Source Worker: `pokeprizepool-chat-realtime-production`

Save the binding and trigger a production deployment so Pages Functions receive the binding. Do not select the staging Worker/class.

## 4. Verify safely

1. Open `https://pokeprizepool.com/chat.html` and sign in with a registered account.
2. Confirm the connection indicator changes to **Live · connected**.
3. Open the same page in a second browser profile signed into another registered account.
4. Send a test message and confirm it appears in both windows without refreshing.
5. Delete the test message and confirm the deletion reaches both windows.
6. Confirm the staging preview still works independently.

If a step fails, stop before changing D1 or Stripe settings. Check the production Pages binding and that the production Pages secret exactly matches the production Worker secret.

## Important

The existing chat API currently has no general-member @username autocomplete or notification workflow wired into ordinary chat posts. Do not consider mentions complete until a separate code change is reviewed and tested with two accounts. This setup alone configures real-time delivery; it does not implement mentions.
