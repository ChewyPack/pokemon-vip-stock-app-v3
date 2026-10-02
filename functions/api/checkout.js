/*
 * POST /api/checkout
 *
 * Creates a Stripe Checkout Session for VIP membership.
 *
 * Body:
 *   { "plan": "monthly" }
 *   { "plan": "yearly" }
 */

const MONTHLY_PRICE =
  'price_1ULZQSGXWs1THDBRMRXDSCaj';

const YEARLY_PRICE =
  'price_1ULZQSGXWs1THDBRLb2MUNtf';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    }
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.STRIPE_SECRET_KEY) {
    return json(
      {
        ok: false,
        error: 'stripe_not_configured'
      },
      500
    );
  }

  let data;

  try {
    data = await request.json();
  } catch (e) {
    return json(
      {
        ok: false,
        error: 'bad_request'
      },
      400
    );
  }

  const plan =
    data && data.plan === 'yearly'
      ? 'yearly'
      : data && data.plan === 'monthly'
        ? 'monthly'
        : '';

  if (!plan) {
    return json(
      {
        ok: false,
        error: 'invalid_plan'
      },
      400
    );
  }

  const priceId =
    plan === 'yearly'
      ? YEARLY_PRICE
      : MONTHLY_PRICE;

  const origin = new URL(request.url).origin;

  const params = new URLSearchParams();

  params.set('mode', 'subscription');
  params.set('line_items[0][price]', priceId);
  params.set('line_items[0][quantity]', '1');

  params.set(
    'success_url',
    origin +
      '/?checkout=success&session_id={CHECKOUT_SESSION_ID}#report'
  );

  params.set(
    'cancel_url',
    origin + '/#report'
  );

  params.set(
    'billing_address_collection',
    'auto'
  );

  params.set(
    'allow_promotion_codes',
    'true'
  );

  params.set(
    'subscription_data[metadata][membership_type]',
    plan
  );

  const response = await fetch(
    'https://api.stripe.com/v1/checkout/sessions',
    {
      method: 'POST',
      headers: {
        Authorization:
          'Bearer ' + env.STRIPE_SECRET_KEY,
        'Content-Type':
          'application/x-www-form-urlencoded'
      },
      body: params
    }
  );

  let result;

  try {
    result = await response.json();
  } catch (e) {
    return json(
      {
        ok: false,
        error: 'stripe_error'
      },
      502
    );
  }

  if (!response.ok || !result.url) {
    console.error(
      'Stripe Checkout error:',
      result
    );

    return json(
      {
        ok: false,
        error: 'stripe_error'
      },
      502
    );
  }

  return json({
    ok: true,
    url: result.url
  });
}

export async function onRequest() {
  return json(
    {
      ok: false,
      error: 'method_not_allowed'
    },
    405
  );
}
