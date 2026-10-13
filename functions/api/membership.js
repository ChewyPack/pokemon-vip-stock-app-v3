
/*
 * /api/membership
 *
 * GET:
 *   Checks whether the current browser has an active VIP session.
 *
 * POST:
 *   Verifies a completed Stripe Checkout Session, creates or refreshes
 *   the matching membership record, and creates a VIP browser session.
 *
 * Cloudflare D1 binding:
 *   DB -> pokemon-vip-members
 *
 * Required environment variable:
 *   STRIPE_SECRET_KEY
 */

const SESSION_COOKIE = 'vip_session';
const SESSION_DAYS = 30;

const MONTHLY_PRICE_ID = 'price_1ULZQSGXWs1THDBRMRXDSCaj';
const YEARLY_PRICE_ID = 'price_1ULZQSGXWs1THDBRLb2MUNtf';

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...extraHeaders
    }
  });
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sha256(value) {
  return crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
}

function sessionCookie(token, expiresAt) {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`
  ].join('; ');
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';

  for (const part of header.split(';')) {
    const trimmed = part.trim();

    if (trimmed.startsWith(name + '=')) {
      return trimmed.substring(name.length + 1);
    }
  }

  return '';
}

async function createSession(env, userId) {
  const random = crypto.getRandomValues(new Uint8Array(32));
  const token = base64Url(random);
  const tokenHash = base64Url(await sha256(token));

  const expiresAt =
    Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;

  const result = await env.DB.prepare(
    `UPDATE users
     SET session_token_hash = ?,
         session_expires_at = ?
     WHERE id = ?
       AND membership_status = 'active'`
  )
    .bind(tokenHash, expiresAt, userId)
    .run();

  if (!result.meta || result.meta.changes < 1) {
    throw new Error(
      'Session was not saved: member is missing or inactive.'
    );
  }

  return { token, expiresAt };
}

async function getActiveSession(request, env) {
  const token = getCookie(request, SESSION_COOKIE);

  if (!token) {
    return null;
  }

  const tokenHash = base64Url(await sha256(token));

  const member = await env.DB.prepare(
    `SELECT id, name, email, membership_status,
            membership_type, session_expires_at
     FROM users
     WHERE session_token_hash = ?
       AND membership_status = 'active'
     LIMIT 1`
  )
    .bind(tokenHash)
    .first();

  if (!member) {
    return null;
  }

  if (
    !member.session_expires_at ||
    Number(member.session_expires_at) <= Date.now()
  ) {
    return null;
  }

  return member;
}

function getMembershipType(session, subscription) {
  const sessionType = session.metadata?.membership_type;
  const subscriptionType = subscription.metadata?.membership_type;

  if (sessionType === 'yearly' || sessionType === 'monthly') {
    return sessionType;
  }

  if (
    subscriptionType === 'yearly' ||
    subscriptionType === 'monthly'
  ) {
    return subscriptionType;
  }

  const items = subscription.items?.data || [];

  for (const item of items) {
    const priceId = item.price?.id;

    if (priceId === YEARLY_PRICE_ID) {
      return 'yearly';
    }

    if (priceId === MONTHLY_PRICE_ID) {
      return 'monthly';
    }
  }

  // Preserve the previous app behavior for an unrecognized price ID.
  return 'monthly';
}

async function verifyCheckoutSession(sessionId, env) {
  if (!sessionId || !env.STRIPE_SECRET_KEY) {
    return null;
  }

  const response = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`,
    {
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`
      }
    }
  );

  if (!response.ok) {
    console.error(
      'Stripe Checkout verification failed:',
      response.status
    );
    return null;
  }

  const session = await response.json();

  if (
    session.mode !== 'subscription' ||
    session.status !== 'complete'
  ) {
    return null;
  }

  if (
    session.payment_status !== 'paid' &&
    session.payment_status !== 'no_payment_required'
  ) {
    return null;
  }

  const subscription = session.subscription;

  // Fail closed unless Stripe returned the expanded subscription
  // and confirms it is currently active or trialing.
  if (
    !subscription ||
    typeof subscription !== 'object' ||
    !['active', 'trialing'].includes(subscription.status)
  ) {
    return null;
  }

  const email = (
    session.customer_details?.email ||
    session.customer_email ||
    ''
  ).trim().toLowerCase();

  if (!email) {
    return null;
  }

  return {
    email,
    name: (
      session.customer_details?.name ||
      ''
    ).trim(),
    membershipType: getMembershipType(session, subscription)
  };
}

/*
 * Find the member by normalized email.
 * If the webhook has not created the row yet, create it from the
 * independently verified Stripe checkout.
 *
 * Existing Discord fields are deliberately not overwritten.
 */
async function activateVerifiedMember(checkout, env) {
  let member = await env.DB.prepare(
    `SELECT id, name, email, membership_status,
            membership_type
     FROM users
     WHERE LOWER(TRIM(email)) = ?
     LIMIT 1`
  )
    .bind(checkout.email)
    .first();

  if (member) {
    await env.DB.prepare(
      `UPDATE users
       SET name = CASE
                    WHEN ? <> '' THEN ?
                    ELSE name
                  END,
           membership_status = 'active',
           membership_type = ?
       WHERE id = ?`
    )
      .bind(
        checkout.name,
        checkout.name,
        checkout.membershipType,
        member.id
      )
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO users (
         name,
         email,
         membership_status,
         membership_type
       )
       VALUES (?, ?, 'active', ?)
       ON CONFLICT(email) DO UPDATE SET
         name = CASE
                  WHEN excluded.name IS NOT NULL
                       AND TRIM(excluded.name) <> ''
                  THEN excluded.name
                  ELSE users.name
                END,
         membership_status = 'active',
         membership_type = excluded.membership_type`
    )
      .bind(
        checkout.name,
        checkout.email,
        checkout.membershipType
      )
      .run();
  }

  member = await env.DB.prepare(
    `SELECT id, name, email, membership_status,
            membership_type
     FROM users
     WHERE LOWER(TRIM(email)) = ?
     LIMIT 1`
  )
    .bind(checkout.email)
    .first();

  if (!member || member.membership_status !== 'active') {
    throw new Error(
      'Verified membership could not be activated in D1.'
    );
  }

  return member;
}

export async function onRequestGet({ request, env }) {
  try {
    const member = await getActiveSession(request, env);

    if (!member) {
      return json({
        ok: true,
        active: false
      });
    }

    return json({
      ok: true,
      active: true,
      member: {
        name: member.name || '',
        email: member.email,
        membership_type: member.membership_type || ''
      }
    });
  } catch (error) {
    console.error('Membership check error:', error);

    return json({
      ok: false,
      active: false,
      error: 'membership_check_failed'
    }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.STRIPE_SECRET_KEY) {
    return json({
      ok: false,
      error: 'stripe_not_configured'
    }, 500);
  }

  let data;

  try {
    data = await request.json();
  } catch {
    return json({
      ok: false,
      error: 'bad_request'
    }, 400);
  }

  const sessionId =
    typeof data?.session_id === 'string'
      ? data.session_id.trim()
      : '';

  if (!sessionId) {
    return json({
      ok: false,
      error: 'missing_session'
    }, 400);
  }

  try {
    const checkout = await verifyCheckoutSession(
      sessionId,
      env
    );

    if (!checkout) {
      return json({
        ok: false,
        error: 'invalid_checkout'
      }, 400);
    }

    // Activate or repair the D1 record only after Stripe verification.
    const member = await activateVerifiedMember(checkout, env);

    // Create a website session for the verified active member.
    const session = await createSession(env, member.id);

    return json(
      {
        ok: true,
        active: true,
        member: {
          name: member.name || checkout.name || '',
          email: member.email,
          membership_type: member.membership_type || ''
        }
      },
      200,
      {
        'Set-Cookie': sessionCookie(
          session.token,
          session.expiresAt
        )
      }
    );
  } catch (error) {
    console.error('Membership setup error:', error);

    return json({
      ok: false,
      error: 'membership_setup_failed'
    }, 500);
  }
}

export async function onRequest() {
  return json({
    ok: false,
    error: 'method_not_allowed'
  }, 405);
}
