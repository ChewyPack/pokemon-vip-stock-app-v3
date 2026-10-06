const SESSION_COOKIE = 'vip_session';
const SESSION_DAYS = 30;

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

function sessionCookie(
  token,
  expiresAt
) {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Expires=${new Date(
      expiresAt
    ).toUTCString()}`
  ].join('; ');
}

async function createVipSession(
  env,
  memberId
) {
  const random =
    crypto.getRandomValues(
      new Uint8Array(32)
    );

  const token =
    base64Url(random);

  const hashBuffer =
    await sha256(token);

  const tokenHash =
    base64Url(hashBuffer);

  const expiresAt =
    Date.now() +
    SESSION_DAYS *
      24 *
      60 *
      60 *
      1000;

  await env.DB.prepare(
    `UPDATE users
     SET session_token_hash = ?,
         session_expires_at = ?
     WHERE id = ?
       AND membership_status = 'active'`
  )
    .bind(
      tokenHash,
      expiresAt,
      memberId
    )
    .run();

  return {
    token,
    expiresAt
  };
}

async function addVipRole(
  discordUserId,
  env
) {
  const url =
    `https://discord.com/api/v10/guilds/` +
    `${env.DISCORD_GUILD_ID}/members/` +
    `${discordUserId}/roles/` +
    `${env.DISCORD_VIP_ROLE_ID}`;

  const response =
    await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization:
          `Bot ${env.DISCORD_BOT_TOKEN}`
      }
    });

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(
      'Discord VIP role assignment failed:',
      response.status,
      errorText
    );

    throw new Error(
      'discord_role_assignment_failed'
    );
  }
}

async function exchangeDiscordCode(
  code,
  env
) {
  const tokenResponse =
    await fetch(
      'https://discord.com/api/oauth2/token',
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded'
        },
        body:
          new URLSearchParams({
            client_id:
              env.DISCORD_CLIENT_ID,
            client_secret:
              env.DISCORD_CLIENT_SECRET,
            grant_type:
              'authorization_code',
            code,
            redirect_uri:
              env.DISCORD_REDIRECT_URI
          })
      }
    );

  if (!tokenResponse.ok) {
    const errorText =
      await tokenResponse.text();

    console.error(
      'Discord token exchange failed:',
      tokenResponse.status,
      errorText
    );

    return null;
  }

  return await tokenResponse.json();
}

async function getDiscordUser(
  accessToken
) {
  const response =
    await fetch(
      'https://discord.com/api/users/@me',
      {
        headers: {
          Authorization:
            `Bearer ${accessToken}`
        }
      }
    );

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(
      'Discord user lookup failed:',
      response.status,
      errorText
    );

    return null;
  }

  return await response.json();
}

/*
 * NORMAL DISCORD CONNECTION
 *
 * This is the existing authenticated flow.
 */
async function handleNormalConnection(
  request,
  env,
  code,
  state
) {
  /*
   * The member must already have a valid
   * VIP browser session.
   */
  const header =
    request.headers.get('Cookie') || '';

  let sessionToken = '';

  for (
    const part of header.split(';')
  ) {
    const trimmed = part.trim();

    if (
      trimmed.startsWith(
        SESSION_COOKIE + '='
      )
    ) {
      sessionToken =
        trimmed.substring(
          SESSION_COOKIE.length + 1
        );

      break;
    }
  }

  if (!sessionToken) {
    return redirect('/#report');
  }

  const sessionHashBuffer =
    await sha256(sessionToken);

  const sessionTokenHash =
    base64Url(
      sessionHashBuffer
    );

  const member =
    await env.DB.prepare(
      `SELECT id, name, email,
              membership_status,
              session_expires_at,
              discord_oauth_state,
              discord_oauth_state_expires_at
       FROM users
       WHERE session_token_hash = ?
         AND membership_status = 'active'
       LIMIT 1`
    )
      .bind(sessionTokenHash)
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

  if (
    !member.discord_oauth_state ||
    member.discord_oauth_state !== state
  ) {
    return redirect('/#discord-error');
  }

  if (
    !member.discord_oauth_state_expires_at ||
    Number(
      member.discord_oauth_state_expires_at
    ) < Date.now()
  ) {
    return redirect('/#discord-error');
  }

  const tokenData =
    await exchangeDiscordCode(
      code,
      env
    );

  if (
    !tokenData ||
    !tokenData.access_token
  ) {
    return redirect('/#discord-error');
  }

  const discordUser =
    await getDiscordUser(
      tokenData.access_token
    );

  if (
    !discordUser ||
    !discordUser.id
  ) {
    return redirect('/#discord-error');
  }

  /*
   * Save the Discord account to this
   * authenticated VIP member.
   */
  await env.DB.prepare(
    `UPDATE users
     SET discord_user_id = ?,
         discord_username = ?,
         discord_connected_at = ?,
         discord_oauth_state = NULL,
         discord_oauth_state_expires_at = NULL
     WHERE id = ?`
  )
    .bind(
      String(discordUser.id),
      discordUser.global_name ||
        discordUser.username ||
        'Discord User',
      Date.now(),
      member.id
    )
    .run();

  await addVipRole(
    String(discordUser.id),
    env
  );

  return redirect(
    '/#discord-connected'
  );
}

/*
 * DISCORD RECOVERY
 *
 * The user does NOT need an existing
 * vip_session.
 */
async function handleRecovery(
  env,
  code,
  state
) {
  const stateHashBuffer =
    await sha256(state);

  const stateHash =
    base64Url(
      stateHashBuffer
    );

  /*
   * Find the temporary recovery attempt.
   */
  const recovery =
    await env.DB.prepare(
      `SELECT id, expires_at
       FROM discord_recovery
       WHERE state_hash = ?
       LIMIT 1`
    )
      .bind(stateHash)
      .first();

  if (!recovery) {
    return redirect('/#discord-error');
  }

  /*
   * The recovery state is single-use.
   */
  await env.DB.prepare(
    `DELETE FROM discord_recovery
     WHERE id = ?`
  )
    .bind(recovery.id)
    .run();

  if (
    !recovery.expires_at ||
    Number(recovery.expires_at) <
      Date.now()
  ) {
    return redirect('/#discord-error');
  }

  /*
   * Exchange the Discord authorization code.
   */
  const tokenData =
    await exchangeDiscordCode(
      code,
      env
    );

  if (
    !tokenData ||
    !tokenData.access_token
  ) {
    return redirect('/#discord-error');
  }

  /*
   * Get the verified Discord identity.
   */
  const discordUser =
    await getDiscordUser(
      tokenData.access_token
    );

  if (
    !discordUser ||
    !discordUser.id
  ) {
    return redirect('/#discord-error');
  }

  const discordUserId =
    String(discordUser.id);

  /*
   * Find the VIP member whose account is already
   * linked to this Discord account.
   */
  const member =
    await env.DB.prepare(
      `SELECT id, name, email,
              membership_status,
              membership_type,
              discord_user_id
       FROM users
       WHERE discord_user_id = ?
       LIMIT 1`
    )
      .bind(discordUserId)
      .first();

  if (!member) {
    /*
     * This Discord account has never been
     * connected to a VIP membership.
     */
    return redirect(
      '/#discord-recovery-error'
    );
  }

  /*
   * Membership must still be active.
   */
  if (
    member.membership_status !==
    'active'
  ) {
    return redirect(
      '/#discord-recovery-error'
    );
  }

  /*
   * Create a fresh VIP browser session.
   */
  const session =
    await createVipSession(
      env,
      member.id
    );

  /*
   * Make sure the Discord account still has
   * the VIP role.
   */
  try {
    await addVipRole(
      discordUserId,
      env
    );
  } catch (error) {
    /*
     * Don't block website access if the role
     * assignment happens to fail.
     */
    console.error(
      'Discord role refresh failed:',
      error
    );
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location:
        '/#discord-recovered',
      'Set-Cookie':
        sessionCookie(
          session.token,
          session.expiresAt
        )
    }
  });
}

export async function onRequestGet({
  request,
  env
}) {
  try {
    const requestUrl =
      new URL(request.url);

    const code =
      requestUrl.searchParams.get(
        'code'
      );

    const state =
      requestUrl.searchParams.get(
        'state'
      );

    const oauthError =
      requestUrl.searchParams.get(
        'error'
      );

    if (oauthError) {
      console.error(
        'Discord OAuth error:',
        oauthError
      );

      return redirect(
        '/#discord-error'
      );
    }

    if (!code || !state) {
      return redirect(
        '/#discord-error'
      );
    }

    /*
     * First determine whether this is a
     * recovery attempt.
     */
    const stateHashBuffer =
      await sha256(state);

    const stateHash =
      base64Url(
        stateHashBuffer
      );

    const recovery =
      await env.DB.prepare(
        `SELECT id
         FROM discord_recovery
         WHERE state_hash = ?
         LIMIT 1`
      )
        .bind(stateHash)
        .first();

    if (recovery) {
      return await handleRecovery(
        env,
        code,
        state
      );
    }

    /*
     * Otherwise this is the normal
     * authenticated Discord connection.
     */
    return await handleNormalConnection(
      request,
      env,
      code,
      state
    );
  } catch (error) {
    console.error(
      'Discord callback error:',
      error
    );

    return redirect(
      '/#discord-error'
    );
  }
}
