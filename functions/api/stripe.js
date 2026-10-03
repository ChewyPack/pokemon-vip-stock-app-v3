async function removeVipRole(discordUserId, env) {
  if (!discordUserId) {
    return;
  }

  const url = `https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/members/${discordUserId}/roles/${env.DISCORD_VIP_ROLE_ID}`;

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

async function addVipRole(discordUserId, env) {
  if (!discordUserId) {
    return;
  }

  const url = `https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/members/${discordUserId}/roles/${env.DISCORD_VIP_ROLE_ID}`;

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

async function getCustomerEmail(customerId, env) {
  if (!customerId) {
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
    const errorText = await customerResponse.text();

    console.error(
      "Stripe customer lookup failed:",
      customerResponse.status,
      errorText
    );

    return "";
  }

  const customer = await customerResponse.json();

  return customer.email || "";
}

function getMembershipType(subscription) {
  const metadataType =
    subscription.metadata?.membership_type || "";

  if (
    metadataType === "yearly" ||
    metadataType === "monthly"
  ) {
    return metadataType;
  }

  const priceId =
    subscription.items?.data?.[0]?.price?.id || "";

  if (
    priceId === "price_1ULZQSGXWs1THDBRLb2MUNtf"
  ) {
    return "yearly";
  }

  return "monthly";
}

async function updateMemberStatus(
  email,
  status,
  membershipType,
  env
) {
  if (!email) {
    return;
  }

  await env.DB.prepare(
    `UPDATE users
     SET membership_status = ?,
         membership_type = ?
     WHERE email = ?`
  )
    .bind(
      status,
      membershipType,
      email
    )
    .run();

  const discordMember =
    await env.DB.prepare(
      `SELECT discord_user_id
       FROM users
       WHERE email = ?
       LIMIT 1`
    )
      .bind(email)
      .first();

  if (
    !discordMember ||
    !discordMember.discord_user_id
  ) {
    return;
  }

  if (status === "active") {
    await addVipRole(
      discordMember.discord_user_id,
      env
    );
  } else {
    await removeVipRole(
      discordMember.discord_user_id,
      env
    );
  }
}

export async function onRequestPost({
  request,
  env
}) {
  const signature =
    request.headers.get("stripe-signature");

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

  const body = await request.text();

  const event =
    await verifyStripeSignature(
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
        const session =
          event.data.object;

        const email =
          session.customer_details?.email ||
          session.customer_email ||
          "";

        if (!email) {
          break;
        }

        let membershipType = "monthly";

        const metadataType =
          session.subscription_details
            ?.metadata
            ?.membership_type ||
          session.metadata
            ?.membership_type ||
          "";

        if (
          metadataType === "yearly" ||
          metadataType === "monthly"
        ) {
          membershipType = metadataType;
        } else if (
          session.line_items?.data?.length
        ) {
          const priceId =
            session.line_items.data[0]
              ?.price?.id || "";

          if (
            priceId ===
            "price_1ULZQSGXWs1THDBRLb2MUNtf"
          ) {
            membershipType = "yearly";
          }
        }

        await env.DB.prepare(
          `INSERT INTO users
            (name, email, membership_status, membership_type)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(email)
           DO UPDATE SET
             membership_status =
               excluded.membership_status,
             membership_type =
               excluded.membership_type`
        )
          .bind(
            session.customer_details
              ?.name || "",
            email,
            "active",
            membershipType
          )
          .run();

        const discordMember =
          await env.DB.prepare(
            `SELECT discord_user_id
             FROM users
             WHERE email = ?
             LIMIT 1`
          )
            .bind(email)
            .first();

        if (
          discordMember &&
          discordMember.discord_user_id
        ) {
          await addVipRole(
            discordMember.discord_user_id,
            env
          );
        }

        break;
      }

      case "customer.subscription.created": {
        const subscription =
          event.data.object;

        const customerId =
          subscription.customer;

        const status =
          subscription.status === "active" ||
          subscription.status === "trialing"
            ? "active"
            : "inactive";

        const membershipType =
          getMembershipType(subscription);

        const email =
          await getCustomerEmail(
            customerId,
            env
          );

        if (email) {
          await updateMemberStatus(
            email,
            status,
            membershipType,
            env
          );
        }

        break;
      }

      case "customer.subscription.updated": {
        const subscription =
          event.data.object;

        const customerId =
          subscription.customer;

        const status =
          subscription.status === "active" ||
          subscription.status === "trialing"
            ? "active"
            : "inactive";

        const membershipType =
          getMembershipType(subscription);

        const email =
          await getCustomerEmail(
            customerId,
            env
          );

        if (email) {
          await updateMemberStatus(
            email,
            status,
            membershipType,
            env
          );
        }

        break;
      }

      case "customer.subscription.deleted": {
        const subscription =
          event.data.object;

        const customerId =
          subscription.customer;

        const email =
          await getCustomerEmail(
            customerId,
            env
          );

        if (email) {
          await updateMemberStatus(
            email,
            "inactive",
            getMembershipType(subscription),
            env
          );
        }

        break;
      }

      default:
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
      "Stripe webhook error:",
      error
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

async function verifyStripeSignature(
  payload,
  signatureHeader,
  secret
) {
  try {
    const parts =
      signatureHeader.split(",");

    const timestampPart =
      parts.find((p) =>
        p.startsWith("t=")
      );

    const signaturePart =
      parts.find((p) =>
        p.startsWith("v1=")
      );

    if (
      !timestampPart ||
      !signaturePart
    ) {
      return null;
    }

    const timestamp =
      timestampPart.substring(2);

    const signature =
      signaturePart.substring(3);

    const signedPayload =
      timestamp + "." + payload;

    const encoder =
      new TextEncoder();

    const key =
      await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        {
          name: "HMAC",
          hash: "SHA-256"
        },
        false,
        ["sign"]
      );

    const digest =
      await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(signedPayload)
      );

    const expectedSignature =
      Array.from(
        new Uint8Array(digest)
      )
        .map((b) =>
          b
            .toString(16)
            .padStart(2, "0")
        )
        .join("");

    if (
      expectedSignature !==
      signature
    ) {
      return null;
    }

    return JSON.parse(payload);
  } catch (error) {
    console.error(
      "Stripe signature verification error:",
      error
    );

    return null;
  }
}
