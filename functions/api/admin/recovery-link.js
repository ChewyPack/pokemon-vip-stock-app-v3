
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256(value) {
  return crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
}

async function stripeGet(path, env) {
  const response = await fetch(
    `https://api.stripe.com/v1/${path}`,
    {
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("Stripe lookup failed:", response.status);
    throw new Error("stripe_verification_failed");
  }

  return data;
}

const VIP_PRICE_IDS = new Set([
  "price_1UNaOcK5IxhaGczAyrX7Znyy",
  "price_1UNaOcK5IxhaGczAzg3OAdDb",
  "price_1ULZQSGXWs1THDBRMRXDSCaj",
  "price_1ULZQSGXWs1THDBRLb2MUNtf"
]);

async function hasActiveVipSubscription(email, env) {
  const customers = await stripeGet(
    `customers?email=${encodeURIComponent(email)}&limit=100`,
    env
  );

  for (const customer of customers.data || []) {
    if (customer.deleted) continue;

    const subscriptions = await stripeGet(
      `subscriptions?customer=${encodeURIComponent(customer.id)}&status=all&limit=100`,
      env
    );

    for (const subscription of subscriptions.data || []) {
      if (
        subscription.status !== "active" &&
        subscription.status !== "trialing"
      ) {
        continue;
      }

      const items = subscription.items?.data || [];

      if (
        items.some(item =>
          VIP_PRICE_IDS.has(item.price?.id)
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

export async function onRequestPost({ request, env }) {
  try {
    const configuredToken =
      String(env.VIP_RECOVERY_ADMIN_TOKEN || "");

    const authorization =
      request.headers.get("Authorization") || "";

    if (
      !configuredToken ||
      authorization !== `Bearer ${configuredToken}`
    ) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    if (!env.STRIPE_SECRET_KEY || !env.DB) {
      return json({
        ok: false,
        error: "Recovery configuration is incomplete"
      }, 500);
    }

    const body = await request.json();
    const memberId = Number(body.memberId);

    if (!Number.isSafeInteger(memberId) || memberId < 1) {
      return json({
        ok: false,
        error: "Enter a valid member ID"
      }, 400);
    }

    const member = await env.DB.prepare(
      `SELECT id, email, membership_status
       FROM users
       WHERE id = ?
       LIMIT 1`
    ).bind(memberId).first();

    if (!member || !member.email) {
      return json({
        ok: false,
        error: "Member or member email was not found"
      }, 404);
    }

    if (member.membership_status !== "active") {
      return json({
        ok: false,
        error: "The member is not marked active in the database"
      }, 409);
    }

    const verified = await hasActiveVipSubscription(
      String(member.email).trim().toLowerCase(),
      env
    );

    if (!verified) {
      return json({
        ok: false,
        error: "No active VIP subscription was verified for this member"
      }, 409);
    }

    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS vip_recovery_links (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         user_id INTEGER NOT NULL,
         token_hash TEXT NOT NULL UNIQUE,
         expires_at INTEGER NOT NULL,
         used_at INTEGER,
         created_at INTEGER NOT NULL
       )`
    ).run();

    const rawToken = base64Url(
      crypto.getRandomValues(new Uint8Array(32))
    );

    const tokenHash = base64Url(
      await sha256(rawToken)
    );

    const now = Date.now();
    const expiresAt = now + 30 * 60 * 1000;

    await env.DB.prepare(
      `INSERT INTO vip_recovery_links
         (user_id, token_hash, expires_at, used_at, created_at)
       VALUES (?, ?, ?, NULL, ?)`
    ).bind(
      member.id,
      tokenHash,
      expiresAt,
      now
    ).run();

    const recoveryLink =
      `https://pokeprizepool.com/api/discord/recover?token=${encodeURIComponent(rawToken)}`;

    return json({
      ok: true,
      memberId: member.id,
      expiresAt: new Date(expiresAt).toISOString(),
      recoveryLink
    });
  } catch (error) {
    console.error(
      "Recovery link generation failed:",
      error instanceof Error ? error.message : "Unknown error"
    );

    return json({
      ok: false,
      error: "Could not generate a recovery link. Check the deployment logs."
    }, 500);
  }
}
