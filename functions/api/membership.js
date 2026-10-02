/*
 * /api/membership
 *
 * GET:
 *   Checks whether the current browser has an active VIP session.
 *
 * POST:
 *   Verifies a Stripe Checkout Session and creates a VIP session.
 */

const SESSION_COOKIE = 'vip_session';
const SESSION_DAYS = 30;

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
  const data = new TextEncoder().encode(value);
  return crypto.subtle.digest('SHA-256', data);
}

async function createSession(env, email) {
  const random = crypto.getRandomValues(new Uint8Array(32));
  const token = base64Url(random);

  const hashBuffer = await sha256(token);
  const tokenHash = base64Url(hashBuffer);

  const expiresAt =
    Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;

  await env.DB.prepare(
    `UPDATE users
     SET session_token_hash = ?,
         session_expires_at = ?
     WHERE email = ?
       AND membership_status = 'active'`
  )
    .bind(tokenHash, expiresAt, email)
    .run();

  return {
    token,
    expiresAt
  };
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

  const parts = header.split(';');

  for (const part of parts) {
    const trimmed = part.trim();

    if (trimmed.startsWith(name + '=')) {
      return trimmed.substring(name.length + 1);
    }
  }

  return '';
}

async function getActiveSession(request, env) {
  const token = getCookie(request, SESSION_COOKIE);

  if (!token) {
    return null;
  }

  const hashBuffer = await sha256(token);
  const tokenHash = base64Url(hashBuffer);

  const result = await env.DB.prepare(
    `SELECT id, name, email, membership_status,
            membership_type, session_expires_at
     FROM users
     WHERE session_token_hash = ?
       AND membership_status = 'active'
     LIMIT 1`
  )
    .bind(tokenHash)
    .first();

  if (!result) {
    return null;
  }

  if (
    !result.session_expires_at ||
    Number(result.session_expires_at) < Date.now()
  ) {
    return null;
  }

  return result;
}

async function verifyCheckoutSession(sessionId, env) {
  if (!sessionId) {
    return null;
  }

  const response = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`,
    {
      headers: {
        Authorization:
          'Bearer ' + env.STRIPE_SECRET_KEY
      }
    }
  );

  if (!response.ok) {
    return null;
  }

  const session = await response.json();

  if (session.mode !== 'subscription') {
    return null;
  }

  if (session.payment_status !== 'paid') {
    return null;
  }

  const email =
    session.customer_details?.email ||
    session.customer_email ||
    '';

  if (!email) {
    return null;
  }

  const subscription = session.subscription;

  if (
    subscription &&
    subscription.status !== 'active' &&
    subscription.status !== 'trialing'
  ) {
    return null;
  }

  return {
    email: email.toLowerCase().trim(),
    name: session.customer_details?.name || ''
  };
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
        membership_type:
          member.membership_type || ''
      }
    });
  } catch (error) {
    console.error('Membership check error:', error);

    return json(
      {
        ok: false,
        error: 'membership_check_failed'
      },
      500
    );
  }
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
  } catch (error) {
    return json(
      {
        ok: false,
        error: 'bad_request'
      },
      400
    );
  }

  const sessionId =
    data && typeof data.session_id === 'string'
      ? data.session_id.trim()
      : '';

  if (!sessionId) {
    return json(
      {
        ok: false,
        error: 'missing_session'
      },
      400
    );
  }

  try {
    const checkout =
      await verifyCheckoutSession(
        sessionId,
        env
      );

    if (!checkout) {
      return json(
        {
          ok: false,
          error: 'invalid_checkout'
        },
        400
      );
    }

    const existingUser =
      await env.DB.prepare(
        `SELECT id, name, email, membership_status,
                membership_type
         FROM users
         WHERE email = ?
         LIMIT 1`
      )
        .bind(checkout.email)
        .first();

    if (!existingUser) {
      return json(
        {
          ok: false,
          error: 'membership_not_found'
        },
        403
      );
    }

    if (
      existingUser.membership_status !==
      'active'
    ) {
      return json(
        {
          ok: false,
          error: 'membership_inactive'
        },
        403
      );
    }

    const session =
      await createSession(
        env,
        checkout.email
      );

    return json(
      {
        ok: true,
        active: true,
        member: {
          name:
            existingUser.name ||
            checkout.name ||
            '',
          email: existingUser.email,
          membership_type:
            existingUser.membership_type ||
            ''
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
    console.error(
      'Membership creation error:',
      error
    );

    return json(
      {
        ok: false,
        error: 'membership_setup_failed'
      },
      500
    );
  }
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
