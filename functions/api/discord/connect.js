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
    String.fromCharCode(
      ...new Uint8Array(bytes)
    )
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sha256(value) {
  const data =
    new TextEncoder().encode(value);

  return crypto.subtle.digest(
    'SHA-256',
    data
  );
}

function redirect(url) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url
    }
  });
}

/*
 * NORMAL DISCORD CONNECTION
 *
 * Used by an already-authenticated VIP member
 * who wants to connect Discord for the first time
 * or reconnect/change their Discord connection.
 */
async function startNormalConnect(
  request,
  env
) {
  const token =
    getCookie(
      request,
      SESSION_COOKIE
    );

  if (!token) {
    return redirect('/#report');
  }

  const hashBuffer =
    await sha256(token);

  const tokenHash =
    base64Url(hashBuffer);

  const member =
    await env.DB.prepare(
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
    Number(member.session_expires_at) <
      Date.now()
  ) {
    return redirect('/#report');
  }

  const stateBytes =
    crypto.getRandomValues(
      new Uint8Array(32)
    );

  const state =
    base64Url(stateBytes);

  const expiresAt =
    Date.now() +
    10 * 60 * 1000;

  await env.DB.prepare(
    `UPDATE users
     SET discord_oauth_state = ?,
         discord_oauth_state_expires_at = ?
     WHERE id = ?`
  )
    .bind(
      state,
      expiresAt,
      member.id
    )
    .run();

  const params =
    new URLSearchParams({
      client_id:
        env.DISCORD_CLIENT_ID,
      response_type: 'code',
      redirect_uri:
        env.DISCORD_REDIRECT_URI,
      scope: 'identify',
      state: state
    });

  return redirect(
    `https://discord.com/oauth2/authorize?${params.toString()}`
  );
}

/*
 * DISCORD RECOVERY
 *
 * Used when a VIP member has lost their browser
 * session but previously connected Discord.
 */
async function startRecovery(
  env
) {
  const stateBytes =
    crypto.getRandomValues(
      new Uint8Array(32)
    );

  const state =
    base64Url(stateBytes);

  const hashBuffer =
    await sha256(state);

  const stateHash =
    base64Url(hashBuffer);

  const expiresAt =
    Date.now() +
    10 * 60 * 1000;

  /*
   * Remove expired recovery attempts.
   */
  await env.DB.prepare(
    `DELETE FROM discord_recovery
     WHERE expires_at < ?`
  )
    .bind(Date.now())
    .run();

  /*
   * Store only the hash of the OAuth state.
   */
  await env.DB.prepare(
    `INSERT INTO discord_recovery
     (state_hash, expires_at, created_at)
     VALUES (?, ?, ?)`
  )
    .bind(
      stateHash,
      expiresAt,
      Date.now()
    )
    .run();

  const params =
    new URLSearchParams({
      client_id:
        env.DISCORD_CLIENT_ID,
      response_type: 'code',
      redirect_uri:
        env.DISCORD_REDIRECT_URI,
      scope: 'identify',
      state: state
    });

  return redirect(
    `https://discord.com/oauth2/authorize?${params.toString()}`
  );
}

export async function onRequestGet({
  request,
  env
}) {
  try {
    const url =
      new URL(request.url);

    const recovery =
      url.searchParams.get(
        'recovery'
      );

    /*
     * /api/discord/connect?recovery=1
     *
     * This path does NOT require an existing
     * VIP browser session.
     */
    if (recovery === '1') {
      return await startRecovery(env);
    }

    /*
     * Normal Discord connection still requires
     * an authenticated VIP session.
     */
    return await startNormalConnect(
      request,
      env
    );
  } catch (error) {
    console.error(
      'Discord connect error:',
      error
    );

    return new Response(
      JSON.stringify({
        ok: false,
        error:
          'discord_connect_failed'
      }),
      {
        status: 500,
        headers: {
          'Content-Type':
            'application/json'
        }
      }
    );
  }
}
