const COOKIE = 'collector_session';
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
function cookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const item = part.trim();
    if (item.startsWith(name + '=')) return item.slice(name.length + 1);
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
async function ensureTables(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS poke_prize_giveaways (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    prize_value REAL, image_url TEXT NOT NULL DEFAULT '', start_at TEXT, end_at TEXT,
    eligibility TEXT NOT NULL DEFAULT '', rules TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
    featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0,1)),
    vip_only INTEGER NOT NULL DEFAULT 0 CHECK(vip_only IN (0,1)),
    entry_count INTEGER, published_at TEXT, winner_entry_id INTEGER, winner_selected_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    is_winner INTEGER NOT NULL DEFAULT 0 CHECK(is_winner IN (0,1)),
    UNIQUE(giveaway_id, account_id)
  )`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_poke_prize_giveaway_entries_giveaway ON poke_prize_giveaway_entries(giveaway_id, entered_at)').run();
}
async function currentAccount(request, env) {
  const token = cookie(request, COOKIE);
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
function originAllowed(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}
function randomIndex(max) {
  if (!Number.isSafeInteger(max) || max < 1 || max > 0xffffffff) throw new Error('invalid_entry_count');
  const range = 0x100000000;
  const limit = Math.floor(range / max) * max;
  const sample = new Uint32Array(1);
  do { crypto.getRandomValues(sample); } while (sample[0] >= limit);
  return sample[0] % max;
}
async function getWinnerData(env, giveawayId) {
  return await env.DB.prepare(
    `SELECT e.id AS entry_id, e.giveaway_id, e.account_id, e.entered_at,
      a.display_name, a.email, p.username
     FROM poke_prize_giveaway_entries e
     JOIN accounts a ON a.id = e.account_id
     LEFT JOIN collector_profiles p ON p.account_id = a.id
     WHERE e.giveaway_id = ? ORDER BY e.entered_at ASC, e.id ASC`
  ).bind(giveawayId).all();
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  try {
    await ensureTables(env);
    const url = new URL(request.url);
    if (url.searchParams.get('winners') === '1') {
      const winners = await env.DB.prepare(
        `SELECT g.id, g.title AS giveaway_title, g.winner_selected_at AS announced_at,
          COALESCE(NULLIF(p.username, ''), 'Collector') AS winner_name
         FROM poke_prize_giveaways g
         JOIN poke_prize_giveaway_entries e ON e.id = g.winner_entry_id
         JOIN accounts a ON a.id = e.account_id
         LEFT JOIN collector_profiles p ON p.account_id = a.id
         WHERE g.status = 'published'
         ORDER BY g.winner_selected_at DESC, g.id DESC LIMIT 8`
      ).all();
      return json({ ok: true, winners: winners.results || [] });
    }
    const access = await requireAdmin(request, env);
    if (access.response) return access.response;
    const giveawayId = Number(url.searchParams.get('giveaway_id'));
    if (!Number.isSafeInteger(giveawayId) || giveawayId < 1) return json({ ok: false, error: 'valid_giveaway_id_required' }, 400);
    const giveaway = await env.DB.prepare(
      'SELECT id, title, status, end_at, winner_entry_id, winner_selected_at FROM poke_prize_giveaways WHERE id = ? LIMIT 1'
    ).bind(giveawayId).first();
    if (!giveaway) return json({ ok: false, error: 'giveaway_not_found' }, 404);
    const entries = await getWinnerData(env, giveawayId);
    const winner = giveaway.winner_entry_id
      ? (entries.results || []).find(entry => Number(entry.entry_id) === Number(giveaway.winner_entry_id)) || null
      : null;
    return json({
      ok: true,
      giveaway,
      entries: (entries.results || []).map(entry => ({
        id: Number(entry.entry_id),
        display_name: entry.display_name || 'Collector',
        username: entry.username || '',
        email: entry.email || '',
        entered_at: entry.entered_at,
        winner: Number(entry.entry_id) === Number(giveaway.winner_entry_id)
      })),
      winner: winner ? {
        username: winner.username || '',
        display_name: winner.display_name || 'Collector',
        email: winner.email || ''
      } : null
    });
  } catch (error) {
    console.error('Giveaway entries read failed:', error);
    return json({ ok: false, error: 'giveaway_entries_read_failed' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  if (!originAllowed(request)) return json({ ok: false, error: 'origin_not_allowed' }, 403);
  const access = await requireAdmin(request, env);
  if (access.response) return access.response;
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'bad_request' }, 400); }
  if (body.action !== 'draw_winner') return json({ ok: false, error: 'invalid_action' }, 400);
  const giveawayId = Number(body.giveaway_id);
  if (!Number.isSafeInteger(giveawayId) || giveawayId < 1) return json({ ok: false, error: 'valid_giveaway_id_required' }, 400);

  try {
    await ensureTables(env);
    const giveaway = await env.DB.prepare(
      'SELECT id, title, status, end_at, winner_entry_id FROM poke_prize_giveaways WHERE id = ? LIMIT 1'
    ).bind(giveawayId).first();
    if (!giveaway) return json({ ok: false, error: 'giveaway_not_found' }, 404);
    if (giveaway.status !== 'published') return json({ ok: false, error: 'giveaway_not_published' }, 409);
    if (giveaway.winner_entry_id) return json({ ok: false, error: 'winner_already_selected' }, 409);
    const end = Date.parse(giveaway.end_at || '');
    if (!Number.isFinite(end)) return json({ ok: false, error: 'giveaway_dates_unavailable' }, 409);
    if (Date.now() < end) return json({ ok: false, error: 'giveaway_not_ended' }, 409);

    const countResult = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM poke_prize_giveaway_entries e JOIN accounts a ON a.id = e.account_id WHERE e.giveaway_id = ?'
    ).bind(giveawayId).first();
    const count = Number(countResult?.total || 0);
    if (!count) return json({ ok: false, error: 'no_entries_to_draw' }, 409);

    const offset = randomIndex(count);
    const chosen = await env.DB.prepare(
      `SELECT e.id AS entry_id, e.account_id, e.entered_at, a.display_name, a.email, p.username
       FROM poke_prize_giveaway_entries e
       JOIN accounts a ON a.id = e.account_id
       LEFT JOIN collector_profiles p ON p.account_id = a.id
       WHERE e.giveaway_id = ? ORDER BY e.id ASC LIMIT 1 OFFSET ?`
    ).bind(giveawayId, offset).first();
    if (!chosen) return json({ ok: false, error: 'winner_selection_failed' }, 500);

    const claim = await env.DB.prepare(
      'UPDATE poke_prize_giveaways SET winner_entry_id = ?, winner_selected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND winner_entry_id IS NULL'
    ).bind(chosen.entry_id, giveawayId).run();
    if (Number(claim.meta?.changes || 0) !== 1) return json({ ok: false, error: 'winner_already_selected' }, 409);
    await env.DB.prepare(
      'UPDATE poke_prize_giveaway_entries SET is_winner = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE giveaway_id = ?'
    ).bind(chosen.entry_id, giveawayId).run();

    return json({
      ok: true,
      message: 'Winner selected and saved.',
      giveaway_id: giveawayId,
      winner: {
        entry_id: Number(chosen.entry_id),
        display_name: chosen.display_name || 'Collector',
        username: chosen.username || '',
        email: chosen.email || '',
        entered_at: chosen.entered_at
      },
      total_entries: count,
      winner_selected_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Giveaway winner draw failed:', error);
    return json({ ok: false, error: 'giveaway_winner_draw_failed' }, 500);
  }
}

export async function onRequest() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
