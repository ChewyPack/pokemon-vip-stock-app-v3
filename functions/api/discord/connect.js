```javascript
const SESSION_COOKIE = 'vip_session';
const SESSION_DAYS = 30;

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

function redirect(url, cookie) {
  const headers = { Location: url };
  if (cookie) headers['Set-Cookie'] = cookie;

  return new Response(null, {
    status: 302,
    headers
  });
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

function getDiscordRedirectUri(env) {
  const value = String(env.DISCORD_REDIRECT_URI || '').trim();
  if (!value) throw new Error('DISCORD_REDIRECT_URI is missing');

  const uri = new URL(value);

  if (
    uri.protocol !== 'https:' ||
    uri.hostname !== 'pokeprizepool.com' ||
    uri.pathname !== '/api/discord/callback' ||
    uri.search ||
    uri.hash
  ) {
    throw new Error('Invalid Discord redirect URI');
  }

  return uri.toString();
}

function makeDiscordAuthorizationUrl(env, state) {
  const params = new URLSearchParams({
    client_id: String(env.DISCORD_CLIENT_ID || '').trim(),
    response_type: 'code',
    redirect_uri: getDiscordRedirectUri(env),
    scope: 'identify',
    state
  });

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function makeSessionCookie(token, expiresAt) {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`
  ].join('; ');
}

async function createSession(env, memberId) {
  const token = base64Url(
    crypto.getRandomValues(new Uint8Array(32))
  );
  const tokenHash = base64Url(await sha256(token));
  const expiresAt = Date.now() + SESSION_DAYS * 86400000;

  const result = await env.DB.prepare(
    `UPDATE users
     SET session_token_hash = ?,
         session_expires_at = ?
     WHERE id = ?
       AND membership_status = 'active'`
  ).bind(tokenHash, expiresAt, memberId).run();

  if (!result.success || result.meta?.changes === 0) {
    throw new Error('Could not create VIP session');
  }

  return { token, expiresAt };
}

async function beginDiscordConnect(request, env, member) {
  const state = base64Url(
    crypto.getRandomValues(new Uint8Array(32))
  );
  const expiresAt = Date.now() + 10 * 60 * 1000;

  await env.DB.prepare(
    `UPDATE users
     SET discord_oauth_state = ?,
         discord_oauth_state_expires_at = ?
     WHERE id = ?`
  ).bind(state, expiresAt, member.id).run();

  return redirect(makeDiscordAuthorizationUrl(env, state));
}

async function normalConnect(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return redirect('/#report');

  const tokenHash = base64Url(await sha256(token));

  const member = await env.DB.prepare(
    `SELECT id, membership_status, session_expires_at
     FROM users
     WHERE session_token_hash = ?
       AND membership_status = 'active'
     LIMIT 1`
  ).bind(tokenHash).first();

  if (
    !member ||
    !member.session_expires_at ||
    Number(member.session_expires_at) < Date.now()
  ) {
    return redirect('/#report');
  }

  return beginDiscordConnect(request, env, member);
}

async function verifiedRecovery(request, env) {
  const url = new URL(request.url);
  const sessionId = String(url.searchParams.get('session_id') || '');

  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    return redirect('/#discord-recovery-error');
  }

  const stripeKey = String(env.STRIPE_SECRET_KEY || '').trim();
  if (!stripeKey) throw new Error('STRIPE_SECRET_KEY is missing');

  const stripeResponse = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand%5B%5D=subscription`,
    {
      headers: {
        Authorization: `Bearer ${stripeKey}`
      }
    }
  );

  if (!stripeResponse.ok) {
    console.error('Stripe recovery verification failed:', stripeResponse.status);
    return redirect('/#discord-recovery-error');
  }

  const checkout = await stripeResponse.json();
  const subscription = checkout.subscription;

  const paid =
    checkout.payment_status === 'paid' ||
    checkout.payment_status === 'no_payment_required';

  if (
    checkout.mode !== 'subscription' ||
    checkout.status !== 'complete' ||
    !paid ||
    !subscription ||
    !['active', 'trialing'].includes(subscription.status)
  ) {
    return redirect('/#discord-recovery-error');
  }

  const email = String(
    checkout.customer_details?.email ||
    checkout.customer_email ||
    ''
  ).trim().toLowerCase();

  if (!email) return redirect('/#discord-recovery-error');

  const member = await env.DB.prepare(
    `SELECT id, email, membership_status
     FROM users
     WHERE lower(email) = ?
     LIMIT 1`
  ).bind(email).first();

  if (!member) {
    console.error('Verified Stripe member has no matching D1 user record');
    return redirect('/#discord-recovery-error');
  }

  /*
   * Stripe has verified the existing paid subscription.
   * Refresh the member's status, then create a browser session.
   */
  await env.DB.prepare(
    `UPDATE users
     SET membership_status = 'active'
     WHERE id = ?`
  ).bind(member.id).run();

  const session = await createSession(env, member.id);

  /*
   * Start the normal Discord OAuth flow for this verified member.
   * The browser receives the session cookie before returning from Discord.
   */
  const state = base64Url(
    crypto.getRandomValues(new Uint8Array(32))
  );
  const stateExpiresAt = Date.now() + 10 * 60 * 1000;

  await env.DB.prepare(
    `UPDATE users
     SET discord_oauth_state = ?,
         discord_oauth_state_expires_at = ?
     WHERE id = ?`
  ).bind(state, stateExpiresAt, member.id).run();

  return redirect(
    makeDiscordAuthorizationUrl(env, state),
    makeSessionCookie(session.token, session.expiresAt)
  );
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);

    if (url.searchParams.get('recovery') === '1') {
      return await verifiedRecovery(request, env);
    }

    return await normalConnect(request, env);
  } catch (error) {
    console.error('Discord connect error:', error);

    return new Response(
      JSON.stringify({
        ok: false,
        error: 'discord_connect_failed'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
```
