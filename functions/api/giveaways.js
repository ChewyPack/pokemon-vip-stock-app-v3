const COOKIE = 'collector_session';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
function getCookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const value = part.trim();
    if (value.startsWith(name + '=')) return value.slice(name.length + 1);
  }
  return '';
}
function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(value) {
  return base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
function clean(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function truthy(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}
async function ensureTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS poke_prize_giveaways (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    prize_value REAL,
    image_url TEXT NOT NULL DEFAULT '',
    start_at TEXT,
    end_at TEXT,
    eligibility TEXT NOT NULL DEFAULT '',
    rules TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
    featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0,1)),
    vip_only INTEGER NOT NULL DEFAULT 0 CHECK(vip_only IN (0,1)),
    entry_count INTEGER,
    published_at TEXT,
    winner_entry_id INTEGER,
    winner_selected_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  const columns = await env.DB.prepare('PRAGMA table_info(poke_prize_giveaways)').all();
  const names = new Set((columns.results || []).map(column => column.name));
  if (!names.has('winner_entry_id')) {
    try { await env.DB.prepare('ALTER TABLE poke_prize_giveaways ADD COLUMN winner_entry_id INTEGER').run(); }
    catch (error) { if (!String(error && error.message || '').toLowerCase().includes('duplicate column')) throw error; }
  }
  if (!names.has('winner_selected_at')) {
    try { await env.DB.prepare('ALTER TABLE poke_prize_giveaways ADD COLUMN winner_selected_at TEXT').run(); }
    catch (error) { if (!String(error && error.message || '').toLowerCase().includes('duplicate column')) throw error; }
  }
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS poke_prize_giveaway_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    giveaway_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    entered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    bonus_entries INTEGER NOT NULL DEFAULT 0 CHECK(bonus_entries BETWEEN 0 AND 1000000),
    is_winner INTEGER NOT NULL DEFAULT 0 CHECK(is_winner IN (0,1)),
    UNIQUE(giveaway_id, account_id)
  )`).run();
  const entryColumns = await env.DB.prepare('PRAGMA table_info(poke_prize_giveaway_entries)').all();
  if (!(entryColumns.results || []).some(column => column.name === 'bonus_entries')) {
    try { await env.DB.prepare('ALTER TABLE poke_prize_giveaway_entries ADD COLUMN bonus_entries INTEGER NOT NULL DEFAULT 0').run(); }
    catch (error) { if (!String(error && error.message || '').toLowerCase().includes('duplicate column')) throw error; }
  }
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_poke_prize_giveaway_entries_giveaway ON poke_prize_giveaway_entries(giveaway_id, entered_at)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_poke_prize_giveaways_status ON poke_prize_giveaways(status, featured, end_at)').run();
}
async function currentAccount(request, env) {
  const token = getCookie(request, COOKIE);
  if (!token) return null;
  const account = await env.DB.prepare(
    'SELECT id, is_admin, session_expires_at FROM accounts WHERE session_token_hash = ? LIMIT 1'
  ).bind(await sha256(token)).first();
  if (!account || !account.session_expires_at || Number(account.session_expires_at) <= Date.now()) return null;
  return account;
}
async function requireAdmin(request, env) {
  const account = await currentAccount(request, env);
  if (!account) return { response: json({ ok: false, error: 'login_required' }, 401) };
  if (Number(account.is_admin || 0) !== 1) return { response: json({ ok: false, error: 'admin_required' }, 403) };
  return { account };
}
function validDateTime(value) {
  if (!value) return true;
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) &&
    !Number.isNaN(Date.parse(value));
}
function normalizeDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}
function uploadedImageIsValid(value, requestUrl) {
  if (!value) return true;
  try {
    const image = new URL(value, requestUrl);
    const origin = new URL(requestUrl).origin;
    const key = image.searchParams.get('key') || '';
    return image.origin === origin &&
      image.pathname === '/api/vendor/image' &&
      /^giveaways\/[a-f0-9-]+\.(jpg|png|webp|avif)$/i.test(key);
  } catch {
    return false;
  }
}
function shape(row) {
  if (!row) return null;
  return {
    ...row,
    featured: Number(row.featured || 0) === 1,
    vip_only: Number(row.vip_only || 0) === 1,
    entry_count: Number(row.actual_entry_count ?? row.entry_count ?? 0),
    winner_name: row.winner_name || null,
    winner_username: row.winner_username || null
  };
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  try {
    await ensureTable(env);
    const adminView = new URL(request.url).searchParams.get('admin') === '1';
    if (adminView) {
      const access = await requireAdmin(request, env);
      if (access.response) return access.response;
      const rows = await env.DB.prepare(
        `SELECT g.*,
        (SELECT COALESCE(SUM(1 + e.bonus_entries), 0) FROM poke_prize_giveaway_entries e JOIN accounts a ON a.id = e.account_id WHERE e.giveaway_id = g.id) AS actual_entry_count,
        (SELECT a.display_name FROM poke_prize_giveaway_entries e JOIN accounts a ON a.id = e.account_id WHERE e.id = g.winner_entry_id LIMIT 1) AS winner_name,
        (SELECT p.username FROM poke_prize_giveaway_entries e JOIN collector_profiles p ON p.account_id = e.account_id WHERE e.id = g.winner_entry_id LIMIT 1) AS winner_username
       FROM poke_prize_giveaways g ORDER BY g.updated_at DESC, g.id DESC LIMIT 500`
      ).all();
      return json({ ok: true, giveaways: (rows.results || []).map(shape) });
    }
    const rows = await env.DB.prepare(
      `SELECT g.id, g.title, g.description, g.prize_value, g.image_url, g.start_at, g.end_at, g.eligibility, g.rules, g.status, g.featured, g.vip_only,
        (SELECT COALESCE(SUM(1 + e.bonus_entries), 0) FROM poke_prize_giveaway_entries e JOIN accounts a ON a.id = e.account_id WHERE e.giveaway_id = g.id) AS actual_entry_count,
        g.published_at, g.created_at, g.winner_selected_at,
        (SELECT p.username FROM poke_prize_giveaway_entries e JOIN collector_profiles p ON p.account_id = e.account_id WHERE e.id = g.winner_entry_id LIMIT 1) AS winner_username
       FROM poke_prize_giveaways g WHERE g.status = 'published' ORDER BY g.featured DESC, g.id DESC LIMIT 500`
    ).all();
    return json({ ok: true, giveaways: (rows.results || []).map(shape) });
  } catch (error) {
    console.error('Giveaways read failed:', error);
    return json({ ok: false, error: 'giveaways_read_failed' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  const access = await requireAdmin(request, env);
  if (access.response) return access.response;
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'bad_request' }, 400); }

  const id = Number(data.id || 0);
  const title = clean(data.title, 180);
  const description = clean(data.description, 4000);
  const imageUrl = clean(data.image_url, 1000);
  const startAtInput = clean(data.start_at, 40);
  const endAtInput = clean(data.end_at, 40);
  const eligibility = clean(data.eligibility, 1500);
  const rules = clean(data.rules, 8000);
  const status = data.status === 'published' ? 'published' : 'draft';
  let prizeValue = null;

  if (!title) return json({ ok: false, error: 'title_required' }, 400);
  if (data.prize_value !== null && data.prize_value !== undefined && String(data.prize_value).trim() !== '') {
    prizeValue = Number(data.prize_value);
    if (!Number.isFinite(prizeValue) || prizeValue < 0 || prizeValue > 10000000) {
      return json({ ok: false, error: 'invalid_prize_value' }, 400);
    }
  }
  if (!validDateTime(startAtInput) || !validDateTime(endAtInput)) return json({ ok: false, error: 'invalid_date_time' }, 400);
  const startAt = normalizeDateTime(startAtInput);
  const endAt = normalizeDateTime(endAtInput);
  if ((startAtInput && !startAt) || (endAtInput && !endAt)) return json({ ok: false, error: 'invalid_date_time' }, 400);
  if (startAt && endAt && Date.parse(startAt) >= Date.parse(endAt)) return json({ ok: false, error: 'end_must_follow_start' }, 400);
  if (status === 'published' && (!startAt || !endAt)) return json({ ok: false, error: 'published_dates_required' }, 400);
  if (!uploadedImageIsValid(imageUrl, request.url)) return json({ ok: false, error: 'image_must_be_uploaded' }, 400);

  try {
    await ensureTable(env);
    let existing = null;
    if (id) {
      existing = await env.DB.prepare('SELECT id, published_at FROM poke_prize_giveaways WHERE id = ? LIMIT 1').bind(id).first();
      if (!existing) return json({ ok: false, error: 'giveaway_not_found' }, 404);
    }
    const publishedAt = status === 'published' ? (existing?.published_at || new Date().toISOString()) : null;
    const featured = truthy(data.featured) ? 1 : 0;
    const vipOnly = truthy(data.vip_only) ? 1 : 0;
    let savedId = id;
    if (existing) {
      await env.DB.prepare(
        'UPDATE poke_prize_giveaways SET title=?, description=?, prize_value=?, image_url=?, start_at=?, end_at=?, eligibility=?, rules=?, status=?, featured=?, vip_only=?, published_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
      ).bind(title, description, prizeValue, imageUrl, startAt || null, endAt || null, eligibility, rules, status, featured, vipOnly, publishedAt, id).run();
    } else {
      const result = await env.DB.prepare(
        'INSERT INTO poke_prize_giveaways (title, description, prize_value, image_url, start_at, end_at, eligibility, rules, status, featured, vip_only, published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
      ).bind(title, description, prizeValue, imageUrl, startAt || null, endAt || null, eligibility, rules, status, featured, vipOnly, publishedAt).run();
      savedId = Number(result.meta?.last_row_id || 0);
    }
    const saved = await env.DB.prepare('SELECT * FROM poke_prize_giveaways WHERE id = ? LIMIT 1').bind(savedId).first();
    return json({ ok: true, giveaway: shape(saved) }, existing ? 200 : 201);
  } catch (error) {
    console.error('Giveaway save failed:', error);
    return json({ ok: false, error: 'giveaway_save_failed' }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  const access = await requireAdmin(request, env);
  if (access.response) return access.response;
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isSafeInteger(id) || id < 1) return json({ ok: false, error: 'valid_giveaway_id_required' }, 400);
  try {
    await ensureTable(env);
    await env.DB.prepare('DELETE FROM poke_prize_giveaway_entries WHERE giveaway_id = ?').bind(id).run();
    const result = await env.DB.prepare('DELETE FROM poke_prize_giveaways WHERE id = ?').bind(id).run();
    if (!result.meta || result.meta.changes !== 1) return json({ ok: false, error: 'giveaway_not_found' }, 404);
    return json({ ok: true });
  } catch (error) {
    console.error('Giveaway delete failed:', error);
    return json({ ok: false, error: 'giveaway_delete_failed' }, 500);
  }
}

export async function onRequest() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
