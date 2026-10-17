const COOKIE = 'collector_session';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function cookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const value = part.trim();
    if (value.startsWith(name + '=')) return value.slice(name.length + 1);
  }
  return '';
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\\+/g, '-')
    .replace(/\\//g, '_')
    .replace(/=+$/, '');
}

async function sha256(value) {
  return base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function currentAccount(request, env) {
  const token = cookie(request, COOKIE);
  if (!token) return null;
  const account = await env.DB.prepare(
    'SELECT id, session_expires_at FROM accounts WHERE session_token_hash = ? LIMIT 1'
  ).bind(await sha256(token)).first();
  if (!account || !account.session_expires_at || Number(account.session_expires_at) <= Date.now()) {
    return null;
  }
  return account;
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);

  const query = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 60);
  if (query.length < 2) return json({ ok: false, error: 'query_too_short' }, 400);

  try {
    const viewer = await currentAccount(request, env).catch(() => null);
    const result = await env.DB.prepare(`
      SELECT
        p.account_id,
        p.username,
        p.bio,
        p.avatar_url,
        a.display_name,
        (SELECT COUNT(*) FROM collector_follows f WHERE f.followed_account_id = p.account_id) AS followers,
        (SELECT COUNT(*) FROM collector_follows f WHERE f.follower_account_id = p.account_id) AS following,
        CASE WHEN ? IS NOT NULL AND ? <> p.account_id AND EXISTS (
          SELECT 1 FROM collector_follows f
          WHERE f.follower_account_id = ? AND f.followed_account_id = p.account_id
        ) THEN 1 ELSE 0 END AS is_following
      FROM collector_profiles p
      JOIN accounts a ON a.id = p.account_id
      WHERE p.is_public = 1
        AND (
          instr(lower(p.username), lower(?)) > 0
          OR instr(lower(COALESCE(a.display_name, '')), lower(?)) > 0
        )
        AND (
          ? IS NULL OR NOT EXISTS (
            SELECT 1 FROM collector_blocks b
            WHERE (b.blocker_account_id = ? AND b.blocked_account_id = p.account_id)
               OR (b.blocker_account_id = p.account_id AND b.blocked_account_id = ?)
          )
        )
      ORDER BY
        CASE WHEN lower(p.username) = lower(?) THEN 0
             WHEN lower(COALESCE(a.display_name, '')) = lower(?) THEN 1
             ELSE 2 END,
        lower(COALESCE(a.display_name, p.username)),
        lower(p.username)
      LIMIT 25
    `).bind(
      viewer?.id ?? null,
      viewer?.id ?? null,
      viewer?.id ?? null,
      query,
      query,
      query,
      query,
      viewer?.id ?? null,
      viewer?.id ?? null,
      viewer?.id ?? null
    ).all();

    const results = (result.results || []).map(profile => ({
      username: profile.username,
      display_name: profile.display_name || profile.username,
      bio: profile.bio || '',
      avatar_url: profile.avatar_url || '',
      followers: Number(profile.followers || 0),
      following: Number(profile.following || 0),
      isFollowing: Number(profile.is_following || 0) === 1,
      canFollow: !!viewer && Number(viewer.id) !== Number(profile.account_id)
    }));
    for (const profile of results) delete profile.account_id;
    return json({ ok: true, results });
  } catch (error) {
    console.error('Collector search failed:', error);
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('no such table')) {
      return json({ ok: false, error: 'collector_search_migration_required' }, 500);
    }
    return json({ ok: false, error: 'collector_search_failed' }, 500);
  }
}

export async function onRequest() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
