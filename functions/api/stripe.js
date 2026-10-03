async function removeVipRole(discordUserId, env) {
  if (!discordUserId) {
    return;
  }

  const url =
    `https://discord.com/api/v10/guilds/` +
    `${env.DISCORD_GUILD_ID}/members/` +
    `${discordUserId}/roles/` +
    `${env.DISCORD_VIP_ROLE_ID}`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`
    }
  });

  if (!response.ok && response.status !== 404) {
    const errorText = await response.text();

    console.error(
      'Discord VIP role removal failed:',
      response.status,
      errorText
    );

    throw new Error(
      'discord_role_removal_failed'
    );
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

  const body = await request.text();

  // Stripe signature verification
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

        const email =
          session.customer_details?.email ||
          session.customer_email ||
          "";

        if (!email) {
          break;
        }

        let membershipType = "monthly";

        if (session.line_items?.data?.length) {
          const priceId =
            session.line_items.data[0]?.price?.id || "";

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
             membership_status = excluded.membership_status,
             membership_type = excluded.membership_type`
        )
          .bind(
            session.customer_details?.name || "",
            email,
            "active",
            membershipType
          )
          .run();

        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object;

        const customerId = subscription.customer;

        const status =
          subscription.status === "active" ||
          subscription.status === "trialing"
            ? "active"
            : "inactive";

        const priceId =
          subscription.items?.data?.[0]?.price?.id || "";

        const membershipType =
          priceId ===
          "price_1ULZQSGXWs1THDBRLb2MUNtf"
            ? "yearly"
            : "monthly";

        const customerResponse = await fetch(
          `https://api.stripe.com/v1/customers/${customerId}`,
          {
            headers: {
              Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`
            }
          }
        );

        if (customerResponse.ok) {
          const customer = await customerResponse.json();
          const email = customer.email || "";

          if (email) {
            await env.DB.prepare(
              `UPDATE users
               SET membership_status = ?,
                   membership_type = ?
               WHERE email = ?`
            )
              .bind(status, membershipType, email)
              .run();
          }
        }

        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        const customerResponse = await fetch(
          `https://api.stripe.com/v1/customers/${customerId}`,
          {
            headers: {
              Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`
            }
          }
        );

        if (customerResponse.ok) {
          const customer = await customerResponse.json();
          const email = customer.email || "";

          if (email) {
            await env.DB.prepare(
              `UPDATE users
               SET membership_status = 'inactive'
               WHERE email = ?`
            )
              .bind(email)
              .run();
          }
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
    console.error("Stripe webhook error:", error);

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


// Verify Stripe webhook signature using Web Crypto
async function verifyStripeSignature(
  payload,
  signatureHeader,
  secret
) {
  try {
    const parts = signatureHeader.split(",");

    const timestampPart = parts.find((p) =>
      p.startsWith("t=")
    );

    const signaturePart = parts.find((p) =>
      p.startsWith("v1=")
    );

    if (!timestampPart || !signaturePart) {
      return null;
    }

    const timestamp = timestampPart.substring(2);
    const signature = signaturePart.substring(3);

    const signedPayload =
      timestamp + "." + payload;

    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
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
      .map((b) =>
        b.toString(16).padStart(2, "0")
      )
      .join("");

    if (expectedSignature !== signature) {
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
