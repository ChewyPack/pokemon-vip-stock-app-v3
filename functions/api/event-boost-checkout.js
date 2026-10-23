import { accountStripeConfig, accountStripeConfigError } from "../_lib/account-stripe.js";
import { EVENT_BOOST_PLANS, ensureEventBoostSchema, currentEventBoostAccount } from "../_lib/event-boost.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "database_not_configured" }, 500);
  const stripe = accountStripeConfig(env);
  if (!stripe) return json({ ok: false, error: accountStripeConfigError(env) }, 503);

  const account = await currentEventBoostAccount(request, env);
  if (!account) return json({ ok: false, error: "login_required", message: "Sign in to boost an event." }, 401);

  const origin = request.headers.get("Origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) return json({ ok: false, error: "origin_not_allowed" }, 403);
    } catch { return json({ ok: false, error: "origin_not_allowed" }, 403); }
  }

  let data;
  try { data = await request.json(); }
  catch { return json({ ok: false, error: "bad_request" }, 400); }

  const eventId = Number(data?.event_id);
  const days = Number(data?.duration_days);
  const plan = EVENT_BOOST_PLANS[days];
  if (!Number.isSafeInteger(eventId) || eventId < 1 || !plan) {
    return json({ ok: false, error: "invalid_boost_plan", message: "Choose a valid event boost duration." }, 400);
  }

  try {
    await ensureEventBoostSchema(env);
    const event = await env.DB.prepare(
      "SELECT id, title, owner_account_id, event_date, status FROM poke_report_events WHERE id = ? LIMIT 1"
    ).bind(eventId).first();
    if (!event || event.status !== "published") {
      return json({ ok: false, error: "event_not_published", message: "Only published events can be boosted." }, 409);
    }
    if (String(event.event_date || "") < new Date().toISOString().slice(0, 10)) {
      return json({ ok: false, error: "event_is_past", message: "Only upcoming events can be boosted." }, 409);
    }
    if (!account.is_admin && Number(event.owner_account_id) !== account.id) {
      return json({ ok: false, error: "event_not_owned", message: "You can only boost an event you submitted and that has been approved." }, 403);
    }

    const checkoutOrigin = stripe.origin || new URL(request.url).origin;
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("line_items[0][price_data][currency]", "usd");
    params.set("line_items[0][price_data][unit_amount]", String(plan.amount_cents));
    params.set("line_items[0][price_data][product_data][name]", "PokePrizePool Event Boost");
    params.set("line_items[0][price_data][product_data][description]", plan.name + " for " + String(event.title || "your event"));
    params.set("line_items[0][quantity]", "1");
    params.set("client_reference_id", String(account.id));
    if (account.email) params.set("customer_email", account.email);
    params.set("success_url", checkoutOrigin + "/event.html?id=" + encodeURIComponent(eventId) + "&boost=success&session_id={CHECKOUT_SESSION_ID}");
    params.set("cancel_url", checkoutOrigin + "/event.html?id=" + encodeURIComponent(eventId) + "&boost=cancelled");
    params.set("allow_promotion_codes", "false");
    params.set("metadata[purchase_type]", "event_boost");
    params.set("metadata[account_id]", String(account.id));
    params.set("metadata[event_id]", String(eventId));
    params.set("metadata[duration_days]", String(plan.days));
    params.set("metadata[plan_name]", plan.name);
    params.set("metadata[boost_price_cents]", String(plan.amount_cents));

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + stripe.secretKey,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params
    });
    const result = await response.json();
    if (!response.ok || !result.url) {
      console.error("Event boost checkout creation failed:", response.status, result.error?.type || "unknown");
      return json({ ok: false, error: "stripe_checkout_failed", message: "Secure checkout could not be started. Please try again." }, 502);
    }
    return json({ ok: true, url: result.url, plan: { days: plan.days, amount_cents: plan.amount_cents } });
  } catch (error) {
    console.error("Event boost checkout failed:", error);
    return json({ ok: false, error: "boost_checkout_failed" }, 500);
  }
}

export async function onRequest() {
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
