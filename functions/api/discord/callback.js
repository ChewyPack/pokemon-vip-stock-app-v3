
const SESSION_COOKIE = 'vip_session';

function base64Url(bytes) {
  return btoa(
    String.fromCharCode(...new Uint8Array(bytes))
  )
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

function redirect(path) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: path
    }
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

async function exchangeDiscordCode(code, env) {
  const redirectUri = String(
    env.DISCORD_REDIRECT_URI || ''
  ).trim();

  if (!redirectUri) {
    throw new Error('DISCORD_REDIRECT_URI is missing');
  }

  const response = await fetch(
    'https://discord.com/api/oauth2/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: String(env.DISCORD_CLIENT_ID || ''),
        client_secret: String(env.DISCORD_CLIENT_SECRET || ''),
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      })
    }
  );

  if (!response.ok) {
    console.error(
      'Discord token exchange failed:',
      response.status,
      await response.text()
    );

    return null;
  }

  return response.json();
}

async function getDiscordUser(accessToken) {
  const response = await fetch(
    'https://discord.com/api/users/@me',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  if (!response.ok) {
    console.error(
      'Discord user lookup failed:',
      response.status,
      await response.text()
    );

    return null;
  }

  return response.json();
}

async function addVipRole(discordUserId, env) {
  const guildId = String(env.DISCORD_GUILD_ID || '').trim();
  const roleId = String(env.DISCORD_VIP_ROLE_ID || '').trim();
  const botToken = String(env.DISCORD_BOT_TOKEN || '').trim();

  if (!guildId || !roleId || !botToken) {
    throw new Error('Discord role configuration is missing');
  }

  const response = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${botToken}`
      }
    }
  );

  if (!response.ok) {
    console.error(
      'Discord VIP role assignment failed:',
      response.status,
      await response.text()
    );

    throw new Error('discord_role_assignment_failed');
  }
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');

    if (oauthError) {
      console.error('Discord OAuth returned an error:', oauthError);
      return redirect('/#discord-error');
    }

    if (!code || !state) {
      return redirect('/#discord-error');
    }

    /*
     * Both normal connections and recovery links must use
     * the same active VIP browser session and OAuth state.
     */
    const sessionToken = getCookie(request, SESSION_COOKIE);

    if (!sessionToken) {
      console.error('Discord callback: VIP session cookie missing');
      return redirect('/#discord-error');
    }

    const sessionHash = base64Url(
      await sha256(sessionToken)
    );

    const member = await env.DB.prepare(
      `SELECT id, name, email, membership_status,
              session_expires_at, discord_oauth_state,
              discord_oauth_state_expires_at
       FROM users
       WHERE session_token_hash = ?
         AND membership_status = 'active'
       LIMIT 1`
    ).bind(sessionHash).first();

    if (!member) {
      console.error('Discord callback: active member session not found');
      return redirect('/#discord-error');
    }

    const now = Date.now();

    if (
      !member.session_expires_at ||
      Number(member.session_expires_at) < now
    ) {
      console.error('Discord callback: VIP session expired');
      return redirect('/#discord-error');
    }

    if (
      !member.discord_oauth_state ||
      member.discord_oauth_state !== state
    ) {
      console.error('Discord callback: OAuth state mismatch');
      return redirect('/#discord-error');
    }

    if (
      !member.discord_oauth_state_expires_at ||
      Number(member.discord_oauth_state_expires_at) < now
    ) {
      console.error('Discord callback: OAuth state expired');
      return redirect('/#discord-error');
    }

    /*
     * Exchange the one-time authorization code for a
     * Discord access token and identify the Discord user.
     */
    const tokenData = await exchangeDiscordCode(code, env);

    if (!tokenData || !tokenData.access_token) {
      return redirect('/#discord-error');
    }

    const discordUser = await getDiscordUser(
      tokenData.access_token
    );

    if (!discordUser || !discordUser.id) {
      return redirect('/#discord-error');
    }

    const discordUserId = String(discordUser.id);
    const discordUsername = String(
      discordUser.global_name ||
      discordUser.username ||
      'Discord User'
    );

    /*
     * Do not silently transfer a Discord account that is
     * already linked to a different membership.
     */
    const existingLink = await env.DB.prepare(
      `SELECT id
       FROM users
       WHERE discord_user_id = ?
         AND id != ?
       LIMIT 1`
    ).bind(discordUserId, member.id).first();

    if (existingLink) {
      console.error(
        'Discord account is already linked to another membership'
      );
      return redirect('/#discord-error');
    }

    /*
     * Save the Discord account only if this exact OAuth state
     * is still current and has not expired.
     */
    const saveResult = await env.DB.prepare(
      `UPDATE users
       SET discord_user_id = ?,
           discord_username = ?,
           discord_connected_at = ?,
           discord_oauth_state = NULL,
           discord_oauth_state_expires_at = NULL
       WHERE id = ?
         AND membership_status = 'active'
         AND session_token_hash = ?
         AND discord_oauth_state = ?
         AND discord_oauth_state_expires_at >= ?`
    ).bind(
      discordUserId,
      discordUsername,
      Date.now(),
      member.id,
      sessionHash,
      state,
      Date.now()
    ).run();

    if (
      !saveResult.success ||
      saveResult.meta?.changes !== 1
    ) {
      console.error(
        'Discord callback: membership link was not saved'
      );
      return redirect('/#discord-error');
    }

    /*
     * A role-assignment failure should not undo the successful
     * website membership link. Log it for diagnosis.
     */
    try {
      await addVipRole(discordUserId, env);
    } catch (error) {
      console.error(
        'Discord account linked, but VIP role assignment failed:',
        error instanceof Error ? error.message : error
      );
    }

    return redirect('/#discord-connected');
  } catch (error) {
    console.error(
      'Discord callback error:',
      error instanceof Error ? error.message : error
    );

    return redirect('/#discord-error');
  }
}
