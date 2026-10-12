
async function addVipRole(discordUserId, env) {
  if (!discordUserId) return;

  const url =
    `https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}` +
    `/members/${discordUserId}/roles/${env.DISCORD_VIP_ROLE_ID}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`
    }
  });

  if (!response.ok) {
    const errorText = await response.text();

    console.error(
      "Discord VIP role assignment failed:",
      response.status,
      errorText
    );

    throw new Error("discord_role_assignment_failed");
  }
}

async function removeVipRole(discordUserId, env) {
  if (!discordUserId) return;

  const url =
    `https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}` +
    `/members/${discordUserId}/roles/${env.DISCORD_VIP_ROLE_ID}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`
    }
  });

  if (!response.ok && response.status !== 404) {
    const errorText = await response.text();

    console.error(
      "Discord VIP role removal failed:",
      response.status,
      errorText
    );

    throw new Error("discord_role_removal_failed");
  }
}

async function getCustomerEmail(customerId, env) {
  if (!customerId || !env.STRIPE_SECRET_KEY) {
    return "";
  }

  const customerResponse = await fetch(
    `https://api.stripe.com/v1/customers/${customerId}`,
    {
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`
      }
    }
  );

  if (!customerResponse.ok) {
    console.error(
      "Stripe customer lookup failed:",
      customerResponse.status
    );

    return "";
  }

  const customer = await customerResponse.json();

  return customer.email || "";
}

function getMembershipType(subscription) {
  const metadataType =
    subscription?.metadata?.membership_type || "";

  if (
    metadataType === "yearly" ||
    metadataType === "monthly"
  ) {
    return metadataType;
  }

  const priceId =
    subscription?.items?.data?.[0]?.price?.id || "";

  if (
    priceId === "price_1ULZQSGXWs1THDBRLb2MUNtf"
  ) {
    return "yearly";
  }

  return "monthly";
}

async function getCheckoutMembershipType(session, env) {
  const metadataType =
    session.subscription_details?.metadata?.membership_type ||
    session.metadata?.membership_type ||
    "";

  if (
    metadataType === "yearly" ||
    metadataType === "monthly"
  ) {
    return metadataType;
  }

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;

  if (subscriptionId && env.STRIPE_SECRET_KEY) {
    try {
      const response = await fetch(
        `https://api.stripe.com/v1/subscriptions/${subscriptionId}`,
        {
          headers: {
            Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`
          }
        }
      );

      if (response.ok) {
        const subscription = await response.json();
        return getMembershipType(subscription);
      }

      console.error(
        "Stripe subscription lookup failed:",
        response.status
      );
    } catch (error) {
      console.error(
        "Stripe subscription lookup error:",
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  }

  return "monthly";
}

async function updateMemberStatus(
  email,
  status,
  membershipType,
  env
) {
  if (!email) return;

  await env.DB.prepare(
    `UPDATE users
     SET membership_status = ?,
         membership_type = ?
     WHERE email = ?`
  )
    .bind(status, membershipType, email)
    .run();

  const discordMember = await env.DB.prepare(
    `SELECT discord_user_id
     FROM users
     WHERE email = ?
     LIMIT 1`
  )
    .bind(email)
    .first();

  if (!discordMember?.discord_user_id) return;

  if (status === "active") {
    await addVipRole(discordMember.discord_user_id, env);
  } else {
    await removeVipRole(discordMember.discord_user_id, env);
  }
}

async function verifyStripeSignature(
  payload,
  signatureHeader,
  secret
) {
  try {
    if (
      typeof secret !== "string" ||
      !secret.trim() ||
      typeof signatureHeader !== "string" ||
      !signatureHeader
    ) {
      console.error(
        "Stripe webhook configuration missing:",
        {
          secretConfigured:
            typeof secret === "string" &&
            secret.trim().length > 0,
          signatureHeaderPresent: Boolean(signatureHeader)
        }
      );

      return null;
    }

    const parts = signatureHeader.split(",");

    const timestampPart = parts.find(
      (part) => part.startsWith("t=")
    );

    const signatures = parts
      .filter((part) => part.startsWith("v1="))
      .map((part) => part.substring(3));

    if (!timestampPart || signatures.length === 0) {
      console.error("Stripe signature header is malformed");
      return null;
    }

    const timestamp = timestampPart.substring(2);

    if (!timestamp || !/^\d+$/.test(timestamp)) {
      console.error("Stripe signature timestamp is invalid");
      return null;
    }

    const signedPayload = `${timestamp}.${payload}`;
    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret.trim()),
      {
        name: "HMAC",
        hash: "SHA-256"
      },
      false,
      ["sign"]
    );

    const digest = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(signedPayload)
    );

    const expectedSignature = Array.from(
      new Uint8Array(digest)
    )
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    const matches = signatures.some((signature) => {
      if (
        !/^[a-fA-F0-9]+$/.test(signature) ||
        signature.length !== expectedSignature.length
      ) {
        return false;
      }

      return signature.toLowerCase() === expectedSignature;
    });

    if (!matches) {
      console.error(
        "Stripe signature mismatch:",
        {
          signatureCount: signatures.length,
          timestampPresent: Boolean(timestamp),
          secretConfigured: true
        }
      );

      return null;
    }

    return JSON.parse(payload);
  } catch (error) {
    console.error(
      "Stripe signature verification error:",
      error instanceof Error ? error.message : "Unknown error"
    );

    return null;
  }
}

export async function onRequestPost({ request, env }) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Missing Stripe signature"
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }

  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error("STRIPE_WEBHOOK_SECRET is not configured");

    return new Response(
      JSON.stringify({
        ok: false,
        error: "Webhook configuration error"
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }

  // Verify the exact raw request body sent by Stripe.
  const body = await request.text();

  const event = await verifyStripeSignature(
    body,
    signature,
    env.STRIPE_WEBHOOK_SECRET
  );

  if (!event) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Invalid Stripe signature"
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        if (
          session.payment_status !== "paid" &&
          session.payment_status !== "no_payment_required"
        ) {
          console.log(
            "Checkout session not yet paid:",
            session.id
          );
          break;
        }

        const email =
          session.customer_details?.email ||
          session.customer_email ||
          "";

        if (!email) {
          console.error(
            "Checkout session has no customer email:",
            session.id
          );
          break;
        }

        const membershipType =
          await getCheckoutMembershipType(session, env);

        await env.DB.prepare(
          `INSERT INTO users
            (name, email, membership_status, membership_type)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(email)
           DO UPDATE SET
             membership_status = excluded.membership_status,
             membership_type = excluded.membership_type`
        )
          .bind(
            session.customer_details?.name || "",
            email.trim().toLowerCase(),
            "active",
            membershipType
          )
          .run();

        const discordMember = await env.DB.prepare(
          `SELECT discord_user_id
           FROM users
           WHERE email = ?
           LIMIT 1`
        )
          .bind(email.trim().toLowerCase())
          .first();

        if (discordMember?.discord_user_id) {
          await addVipRole(
            discordMember.discord_user_id,
            env
          );
        }

        console.log(
          "Membership activated:",
          {
            membershipType,
            discordLinked: Boolean(
              discordMember?.discord_user_id
            )
          }
        );

        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object;

        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer?.id;

        const status =
          subscription.status === "active" ||
          subscription.status === "trialing"
            ? "active"
            : "inactive";

        const membershipType =
          getMembershipType(subscription);

        const email = await getCustomerEmail(
          customerId,
          env
        );

        if (email) {
          await updateMemberStatus(
            email.trim().toLowerCase(),
            status,
            membershipType,
            env
          );
        }

        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;

        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer?.id;

        const email = await getCustomerEmail(
          customerId,
          env
        );

        if (email) {
          await updateMemberStatus(
            email.trim().toLowerCase(),
            "inactive",
            getMembershipType(subscription),
            env
          );
        }

        break;
      }

      default:
        console.log(
          "Ignoring unhandled Stripe event:",
          event.type
        );
        break;
    }

    return new Response(
      JSON.stringify({
        received: true
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  } catch (error) {
    console.error(
      "Stripe webhook processing failed:",
      error instanceof Error ? error.message : "Unknown error"
    );

    return new Response(
      JSON.stringify({
        ok: false,
        error: "Webhook processing failed"
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }
}
