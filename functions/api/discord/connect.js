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
    const token = getCookie(request, SESSION_COOKIE);

    if (!token) {
      return redirect('/#report');
    }

    const hashBuffer = await sha256(token);
    const tokenHash = base64Url(hashBuffer);

    const member = await env.DB.prepare(
      `SELECT id, name, email, membership_status, session_expires_at
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

    const stateBytes = crypto.getRandomValues(new Uint8Array(32));
    const state = base64Url(stateBytes);

    const expiresAt = Date.now() + 10 * 60 * 1000;

    await env.DB.prepare(
      `UPDATE users
       SET discord_oauth_state = ?,
           discord_oauth_state_expires_at = ?
       WHERE id = ?`
    )
      .bind(state, expiresAt, member.id)
      .run();

    const params = new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      response_type: 'code',
      redirect_uri: env.DISCORD_REDIRECT_URI,
      scope: 'identify'
    });

    return redirect(
      `https://discord.com/oauth2/authorize?${params.toString()}&state=${encodeURIComponent(state)}`
    );
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

