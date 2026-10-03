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
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
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
    headers: {
      Location: url
    }
  });
}

export async function onRequestGet({ request, env }) {
  try {
    const requestUrl = new URL(request.url);

    const code = requestUrl.searchParams.get('code');
    const state = requestUrl.searchParams.get('state');
    const oauthError = requestUrl.searchParams.get('error');

    if (oauthError) {
      console.error('Discord OAuth error:', oauthError);
      return redirect('/#discord-error');
    }

    if (!code || !state) {
      return redirect('/#discord-error');
    }

    const sessionToken = getCookie(request, SESSION_COOKIE);

    if (!sessionToken) {
      return redirect('/#report');
    }

    const sessionHashBuffer = await sha256(sessionToken);
    const sessionTokenHash = base64Url(sessionHashBuffer);

    const member = await env.DB.prepare(
      `SELECT id, name, email, membership_status,
              session_expires_at, discord_oauth_state,
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
      Number(member.session_expires_at) < Date.now()
    ) {
      return redirect('/#report');
    }

    if (!member.discord_oauth_state) {
      return redirect('/#discord-error');
    }

    if (member.discord_oauth_state !== state) {
      return redirect('/#discord-error');
    }

    if (
      !member.discord_oauth_state_expires_at ||
      Number(member.discord_oauth_state_expires_at) < Date.now()
    ) {
      return redirect('/#discord-error');
    }

    const tokenResponse = await fetch(
      'https://discord.com/api/oauth2/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: env.DISCORD_CLIENT_ID,
          client_secret: env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: env.DISCORD_REDIRECT_URI
        })
      }
    );

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();

      console.error(
        'Discord token exchange failed:',
        tokenResponse.status,
        errorText
      );

      return redirect('/#discord-error');
    }

    const tokenData = await tokenResponse.json();

    const userResponse = await fetch(
      'https://discord.com/api/users/@me',
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`
        }
      }
    );

    if (!userResponse.ok) {
      const errorText = await userResponse.text();

      console.error(
        'Discord user lookup failed:',
        userResponse.status,
        errorText
      );

      return redirect('/#discord-error');
    }

    const discordUser = await userResponse.json();

    if (!discordUser.id) {
      return redirect('/#discord-error');
    }

    const now = Date.now();

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
        discordUser.global_name || discordUser.username || 'Discord User',
        now,
        member.id
      )
      .run();

    return redirect('/#discord-connected');
  } catch (error) {
    console.error('Discord callback error:', error);

    return redirect('/#discord-error');
  }
}
