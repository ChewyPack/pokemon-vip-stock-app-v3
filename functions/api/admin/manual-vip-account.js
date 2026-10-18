const COOKIE = 'collector_session';
const PBKDF2_ITERATIONS = 100000;

// Explicit allowlist from the verified active VIP cohort. This endpoint is
// intentionally limited to these ten staging migration targets.
const VIP_ALLOWLIST = new Map([
  ['beelou17@hotmail.com', 'Jennifer Hopgood'],
  ['ryanmello1028@gmail.com', 'Ryan Mello'],
  ['papitopaz7@gmail.com', 'Jaylen Paz'],
  ['lilkcheshier@gmail.com', 'Kyle Cheshier'],
  ['cameronmorin4@gmail.com', 'Cameron Morin'],
  ['troyandmickayla@gmail.com', 'Troy Macfarland'],
  ['bigjohn062388@gmail.com', 'John Arraial'],
  ['nacamara@gmail.com', 'Nicole Camara'],
  ['james_whalen15@yahoo.com', 'James Whalen'],
  ['baejea@gmail.com', 'Baeli Carroll']
]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}

function getCookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const value = part.trim();
    if (value.startsWith(name + '=')) return value.slice(name.length + 1);
  }
  return '';
}

function b64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/,'');
}

async function sha256(value) {
  return b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  return b64(await crypto.subtle.deriveBits({
    name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256'
  }, key, 256));
}

async function requireAdmin(request, env) {
  const token = getCookie(request, COOKIE);
  if (!token) return null;
  const account = await env.DB.prepare(
    'SELECT id, is_admin, session_expires_at FROM accounts WHERE session_token_hash = ? LIMIT 1'
  ).bind(await sha256(token)).first();
  if (!account || Number(account.is_admin || 0) !== 1 ||
      !account.session_expires_at || Number(account.session_expires_at) <= Date.now()) {
    return null;
  }
  return account;
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);

  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) {
    return json({ ok: false, error: 'same_origin_request_required' }, 403);
  }

  const admin = await requireAdmin(request, env).catch(() => null);
  if (!admin) return json({ ok: false, error: 'admin_login_required' }, 403);

  let data;
  try { data = await request.json(); }
  catch { return json({ ok: false, error: 'bad_request' }, 400); }

  const displayName = typeof data.display_name === 'string' ? data.display_name.trim() : '';
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  const username = typeof data.username === 'string' ? data.username.trim() : '';
  const password = typeof data.password === 'string' ? data.password : '';

  if (displayName.length < 2 || displayName.length > 60) {
    return json({ ok: false, error: 'invalid_display_name' }, 400);
  }
  if (email.length > 254 || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
    return json({ ok: false, error: 'invalid_email' }, 400);
  }
  if (!VIP_ALLOWLIST.has(email)) {
    return json({ ok: false, error: 'email_not_in_verified_vip_list' }, 403);
  }
  if (displayName.toLowerCase() !== VIP_ALLOWLIST.get(email).toLowerCase()) {
    return json({ ok: false, error: 'name_email_mismatch' }, 400);
  }
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
    return json({ ok: false, error: 'invalid_username' }, 400);
  }
  if (password.length < 10 || password.length > 128) {
    return json({ ok: false, error: 'password_requirements' }, 400);
  }

  try {
    const existingEmail = await env.DB.prepare(
      'SELECT id FROM accounts WHERE email = ? COLLATE NOCASE LIMIT 1'
    ).bind(email).first();
    if (existingEmail) return json({ ok: false, error: 'email_already_registered' }, 409);

    const existingUsername = await env.DB.prepare(
      'SELECT account_id FROM collector_profiles WHERE username = ? COLLATE NOCASE LIMIT 1'
    ).bind(username).first();
    if (existingUsername) return json({ ok: false, error: 'username_taken' }, 409);

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltText = b64(salt);
    const hash = await passwordHash(password, salt);

    // One D1 batch keeps account + profile creation together. No session is
    // created for the member, and no Stripe API call or billing mutation occurs.
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO accounts (
          display_name, email, account_type, password_salt, password_hash,
          membership_tier, membership_entitlement_tier, membership_status,
          membership_source, membership_interval
        ) VALUES (?, ?, 'collector', ?, ?, 'collector_plus', 'collector_plus',
          'active', 'legacy_vip_manual', 'monthly')`
      ).bind(displayName, email, saltText, hash),
      env.DB.prepare(
        `INSERT INTO collector_profiles (account_id, username, bio, avatar_url, is_public)
         SELECT id, ?, '', '', 1 FROM accounts WHERE email = ? COLLATE NOCASE`
      ).bind(username, email)
    ]);

    if (!results[0]?.meta || results[0].meta.changes !== 1 ||
        !results[1]?.meta || results[1].meta.changes !== 1) {
      throw new Error('Account and collector profile were not both created');
    }

    const account = await env.DB.prepare(
      'SELECT id FROM accounts WHERE email = ? COLLATE NOCASE LIMIT 1'
    ).bind(email).first();
    if (!account) throw new Error('Created account could not be verified');

    return json({
      ok: true,
      account: {
        id: Number(account.id),
        display_name: displayName,
        email,
        username,
        account_type: 'collector',
        membership_tier: 'collector_plus',
        membership_entitlement_tier: 'collector_plus',
        membership_status: 'active',
        membership_source: 'legacy_vip_manual'
      },
      note: 'Staging account only. No Stripe customer or subscription was changed or linked.'
    }, 201);
  } catch (error) {
    const message = String(error && error.message || '').toLowerCase();
    if (message.includes('unique')) {
      return json({ ok: false, error: 'email_or_username_already_registered' }, 409);
    }
    console.error('Manual VIP staging account creation failed:', error);
    return json({ ok: false, error: 'account_creation_failed' }, 500);
  }
}

export async function onRequest() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
