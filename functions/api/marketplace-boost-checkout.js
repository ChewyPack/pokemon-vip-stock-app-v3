import { accountStripeConfig, accountStripeConfigError } from "../_lib/account-stripe.js";
import { MARKETPLACE_BOOST_PLANS, ensureMarketplaceBoostSchema, currentMarketplaceAccount } from "../_lib/marketplace-boost.js";

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

  const account = await currentMarketplaceAccount(request, env);
  if (!account) return json({ ok: false, error: "login_required", message: "Sign in to boost your own listings." }, 401);

  let data;
  try { data = await request.json(); }
  catch { return json({ ok: false, error: "bad_request" }, 400); }

  const listingId = Number(data?.listing_id);
  const days = Number(data?.duration_days);
  const plan = MARKETPLACE_BOOST_PLANS[days];
  if (!Number.isSafeInteger(listingId) || listingId < 1 || !plan) {
    return json({ ok: false, error: "invalid_boost_plan", message: "Choose a valid boost duration." }, 400);
  }

  try {
    await ensureMarketplaceBoostSchema(env);
    const listing = await env.DB.prepare(
      "SELECT id, account_id, item_name, is_for_sale, listing_status FROM vendor_inventory WHERE id = ? LIMIT 1"
    ).bind(listingId).first();
    if (!listing || Number(listing.account_id) !== account.id) {
      return json({ ok: false, error: "listing_not_owned", message: "You can only boost listings from your own shop." }, 403);
    }
    if (Number(listing.is_for_sale) !== 1 || listing.listing_status !== "active") {
      return json({ ok: false, error: "listing_not_active", message: "Only active listings marked for sale can be boosted." }, 409);
    }

    const origin = stripe.origin || new URL(request.url).origin;
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("line_items[0][price_data][currency]", "usd");
    params.set("line_items[0][price_data][unit_amount]", String(plan.amount_cents));
    params.set("line_items[0][price_data][product_data][name]", "PokePrizePool Marketplace Boost");
    params.set("line_items[0][price_data][product_data][description]", plan.name + " for " + String(listing.item_name || "your marketplace listing"));
    params.set("line_items[0][quantity]", "1");
    params.set("client_reference_id", String(account.id));
    if (account.email) params.set("customer_email", account.email);
    params.set("success_url", origin + "/marketplace.html?boost=success&session_id={CHECKOUT_SESSION_ID}");
    params.set("cancel_url", origin + "/marketplace.html?boost=cancelled");
    params.set("allow_promotion_codes", "false");
    params.set("metadata[purchase_type]", "marketplace_listing_boost");
    params.set("metadata[account_id]", String(account.id));
    params.set("metadata[listing_id]", String(listingId));
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
      console.error("Marketplace boost checkout creation failed:", response.status, result.error?.type || "unknown");
      return json({ ok: false, error: "stripe_checkout_failed", message: "Secure checkout could not be started. Please try again." }, 502);
    }
    return json({ ok: true, url: result.url, plan: { days: plan.days, amount_cents: plan.amount_cents } });
  } catch (error) {
    console.error("Marketplace boost checkout failed:", error);
    return json({ ok: false, error: "boost_checkout_failed" }, 500);
  }
}

export async function onRequest() {
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
