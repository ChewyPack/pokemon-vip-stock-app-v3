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

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

export async function onRequestGet({ request, env }) {
  try {
    const token = getCookie(request, SESSION_COOKIE);

    if (!token) {
      return json({
        ok: true,
        active: false,
        connected: false
      });
    }

    const hashBuffer = await sha256(token);
    const tokenHash = base64Url(hashBuffer);

    const member = await env.DB.prepare(
      `SELECT id, name, email, membership_status,
              session_expires_at, discord_user_id,
              discord_username
       FROM users
       WHERE session_token_hash = ?
         AND membership_status = 'active'
       LIMIT 1`
    )
      .bind(tokenHash)
      .first();

    if (!member) {
      return json({
        ok: true,
        active: false,
        connected: false
      });
    }

    if (
      !member.session_expires_at ||
      Number(member.session_expires_at) < Date.now()
    ) {
      return json({
        ok: true,
        active: false,
        connected: false
      });
    }

    return json({
      ok: true,
      active: true,
      connected: !!member.discord_user_id,
      discord_username: member.discord_username || null
    });
  } catch (error) {
    console.error('Discord status error:', error);

    return json(
      {
        ok: false,
        error: 'discord_status_failed'
      },
      500
    );
  }
}
