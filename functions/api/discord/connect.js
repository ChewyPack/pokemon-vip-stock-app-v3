
const SESSION_COOKIE = 'vip_session';

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

function base64Url(bytes) {
  return btoa(
    String.fromCharCode(...new Uint8Array(bytes))
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  return crypto.subtle.digest('SHA-256', data);
}

function redirect(url) {
  return new Response(null, {
    status: 302,
    headers: { Location: url }
  });
}

/*
 * Read and validate the callback URL.
 * trim() removes hidden spaces and newlines.
 */
function getDiscordRedirectUri(env) {
  const redirectUri = String(
    env.DISCORD_REDIRECT_URI || ''
  ).trim();

  if (!redirectUri) {
    throw new Error('DISCORD_REDIRECT_URI is missing');
  }

  const parsed = new URL(redirectUri);

  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'pokeprizepool.com' ||
    parsed.pathname !== '/api/discord/callback' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      'DISCORD_REDIRECT_URI is not the expected canonical callback URL'
    );
  }

  return parsed.toString();
}

/*
 * Build the Discord authorization URL.
 */
function makeDiscordAuthorizationUrl(env, state) {
  const redirectUri = getDiscordRedirectUri(env);

  const params = new URLSearchParams({
    client_id: String(env.DISCORD_CLIENT_ID || '').trim(),
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'identify',
    state
  });

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

/*
 * NORMAL DISCORD CONNECTION
 */
async function startNormalConnect(request, env) {
  const token = getCookie(request, SESSION_COOKIE);

  if (!token) {
    return redirect('/#report');
  }

  const tokenHash = base64Url(await sha256(token));

  const member = await env.DB.prepare(
    `SELECT id, name, email,
            membership_status,
            session_expires_at
     FROM users
     WHERE session_token_hash = ?
       AND membership_status = 'active'
     LIMIT 1`
  )
    .bind(tokenHash)
    .first();

  if (!member) {
    return redirect('/#report');
  }

  if (
    !member.session_expires_at ||
    Number(member.session_expires_at) < Date.now()
  ) {
    return redirect('/#report');
  }

  const state = base64Url(
    crypto.getRandomValues(new Uint8Array(32))
  );

  const expiresAt = Date.now() + 10 * 60 * 1000;

  await env.DB.prepare(
    `UPDATE users
     SET discord_oauth_state = ?,
         discord_oauth_state_expires_at = ?
     WHERE id = ?`
  )
    .bind(state, expiresAt, member.id)
    .run();

  return redirect(
    makeDiscordAuthorizationUrl(env, state)
  );
}

/*
 * DISCORD RECOVERY
 */
async function startRecovery(env) {
  const state = base64Url(
    crypto.getRandomValues(new Uint8Array(32))
  );

  const stateHash = base64Url(await sha256(state));
  const expiresAt = Date.now() + 10 * 60 * 1000;

  await env.DB.prepare(
    `DELETE FROM discord_recovery
     WHERE expires_at < ?`
  )
    .bind(Date.now())
    .run();

  await env.DB.prepare(
    `INSERT INTO discord_recovery
     (state_hash, expires_at, created_at)
     VALUES (?, ?, ?)`
  )
    .bind(stateHash, expiresAt, Date.now())
    .run();

  return redirect(
    makeDiscordAuthorizationUrl(env, state)
  );
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const recovery = url.searchParams.get('recovery');

    if (recovery === '1') {
      return await startRecovery(env);
    }

    return await startNormalConnect(request, env);
  } catch (error) {
    console.error('Discord connect error:', error);

    return new Response(
      JSON.stringify({
        ok: false,
        error: 'discord_connect_failed'
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  }
}
