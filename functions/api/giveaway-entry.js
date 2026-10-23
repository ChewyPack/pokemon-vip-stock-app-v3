import { activateGoalGiveaways } from '../_lib/giveaway-goal.js';

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
async function ensureTables(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS poke_prize_giveaways (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    prize_value REAL, image_url TEXT NOT NULL DEFAULT '', start_at TEXT,
    start_mode TEXT NOT NULL DEFAULT 'date', start_goal INTEGER, goal_started_at TEXT, end_at TEXT,
    eligibility TEXT NOT NULL DEFAULT '', rules TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
    featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0,1)),
    vip_only INTEGER NOT NULL DEFAULT 0 CHECK(vip_only IN (0,1)),
    entry_count INTEGER, published_at TEXT, winner_entry_id INTEGER, winner_selected_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  let columns = await env.DB.prepare('PRAGMA table_info(poke_prize_giveaways)').all();
  let names = new Set((columns.results || []).map(column => column.name));
  if (!names.has('winner_entry_id')) {
    try { await env.DB.prepare('ALTER TABLE poke_prize_giveaways ADD COLUMN winner_entry_id INTEGER').run(); }
    catch (error) { if (!String(error && error.message || '').toLowerCase().includes('duplicate column')) throw error; }
  }
  if (!names.has('winner_selected_at')) {
    try { await env.DB.prepare('ALTER TABLE poke_prize_giveaways ADD COLUMN winner_selected_at TEXT').run(); }
    catch (error) { if (!String(error && error.message || '').toLowerCase().includes('duplicate column')) throw error; }
  }
  if (!names.has('start_mode')) {
    try { await env.DB.prepare("ALTER TABLE poke_prize_giveaways ADD COLUMN start_mode TEXT NOT NULL DEFAULT 'date'").run(); }
    catch (error) { if (!String(error && error.message || '').toLowerCase().includes('duplicate column')) throw error; }
  }
  if (!names.has('start_goal')) {
    try { await env.DB.prepare('ALTER TABLE poke_prize_giveaways ADD COLUMN start_goal INTEGER').run(); }
    catch (error) { if (!String(error && error.message || '').toLowerCase().includes('duplicate column')) throw error; }
  }
  if (!names.has('goal_started_at')) {
    try { await env.DB.prepare('ALTER TABLE poke_prize_giveaways ADD COLUMN goal_started_at TEXT').run(); }
    catch (error) { if (!String(error && error.message || '').toLowerCase().includes('duplicate column')) throw error; }
  }
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS poke_prize_giveaway_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    giveaway_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    entered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    rules_accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    bonus_entries INTEGER NOT NULL DEFAULT 0 CHECK(bonus_entries BETWEEN 0 AND 1000000),
    is_winner INTEGER NOT NULL DEFAULT 0 CHECK(is_winner IN (0,1)),
    UNIQUE(giveaway_id, account_id)
  )`).run();
  const entryColumns = await env.DB.prepare('PRAGMA table_info(poke_prize_giveaway_entries)').all();
  if (!(entryColumns.results || []).some(column => column.name === 'rules_accepted_at')) {
    try { await env.DB.prepare('ALTER TABLE poke_prize_giveaway_entries ADD COLUMN rules_accepted_at TEXT').run(); }
    catch (error) { if (!String(error && error.message || '').toLowerCase().includes('duplicate column')) throw error; }
  }
  const bonusColumn = await env.DB.prepare('PRAGMA table_info(poke_prize_giveaway_entries)').all();
  if (!(bonusColumn.results || []).some(column => column.name === 'bonus_entries')) {
    try { await env.DB.prepare('ALTER TABLE poke_prize_giveaway_entries ADD COLUMN bonus_entries INTEGER NOT NULL DEFAULT 0').run(); }
    catch (error) { if (!String(error && error.message || '').toLowerCase().includes('duplicate column')) throw error; }
  }
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_poke_prize_giveaway_entries_giveaway ON poke_prize_giveaway_entries(giveaway_id, entered_at)').run();
}
async function currentAccount(request, env) {
  const token = getCookie(request, COOKIE);
  if (!token) return null;
  const account = await env.DB.prepare(
    'SELECT id, email, account_type, is_admin, session_expires_at, membership_status, membership_tier, membership_entitlement_tier FROM accounts WHERE session_token_hash = ? LIMIT 1'
  ).bind(await sha256(token)).first();
  if (!account || !account.session_expires_at || Number(account.session_expires_at) <= Date.now()) return null;
  return account;
}
function originAllowed(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}
function isVip(account) {
  const status = String(account.membership_status || '').toLowerCase();
  const tiers = [account.membership_entitlement_tier, account.membership_tier]
    .filter(Boolean)
    .map(value => String(value).toLowerCase().trim().replace(/\+/g, '_plus').replace(/[\s-]+/g, '_'));
  return ['active', 'trialing'].includes(status) &&
    tiers.some(tier => ['collector_plus', 'vendor', 'vendor_plus', 'organizer', 'organizer_plus', 'vip'].includes(tier));
}
function timestamp(value) {
  if (!value) return NaN;
  const number = Date.parse(value);
  return Number.isFinite(number) ? number : NaN;
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  try {
    await ensureTables(env);
    await activateGoalGiveaways(env);
    const account = await currentAccount(request, env);
    if (!account) return json({ ok: true, authenticated: false, entered_ids: [] });
    const rows = await env.DB.prepare(
      `SELECT e.giveaway_id
       FROM poke_prize_giveaway_entries e
       JOIN poke_prize_giveaways g ON g.id = e.giveaway_id
       WHERE e.account_id = ? AND g.status = 'published'`
    ).bind(account.id).all();
    return json({
      ok: true,
      authenticated: true,
      entered_ids: (rows.results || []).map(row => Number(row.giveaway_id))
    });
  } catch (error) {
    console.error('Giveaway entry status read failed:', error);
    return json({ ok: false, error: 'giveaway_entry_status_failed' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  if (!originAllowed(request)) return json({ ok: false, error: 'origin_not_allowed' }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'bad_request' }, 400); }
  if (body.rules_accepted !== true) return json({ ok: false, error: 'rules_acceptance_required' }, 400);
  const giveawayId = Number(body.giveaway_id);
  if (!Number.isSafeInteger(giveawayId) || giveawayId < 1) return json({ ok: false, error: 'invalid_giveaway_id' }, 400);

  try {
    await ensureTables(env);
    await activateGoalGiveaways(env);
    const account = await currentAccount(request, env);
    if (!account) return json({ ok: false, error: 'login_required' }, 401);
    const giveaway = await env.DB.prepare(
      'SELECT id, title, status, start_at, start_mode, start_goal, goal_started_at, end_at, vip_only, winner_entry_id FROM poke_prize_giveaways WHERE id = ? LIMIT 1'
    ).bind(giveawayId).first();
    if (!giveaway || giveaway.status !== 'published') return json({ ok: false, error: 'giveaway_not_found' }, 404);
    if (giveaway.winner_entry_id) return json({ ok: false, error: 'giveaway_closed' }, 409);
    const goalTriggered = giveaway.start_mode === 'goal';
    const starts = timestamp(goalTriggered ? giveaway.goal_started_at : giveaway.start_at);
    const ends = timestamp(giveaway.end_at);
    if (!Number.isFinite(ends)) return json({ ok: false, error: 'giveaway_dates_unavailable' }, 409);
    if (!Number.isFinite(starts)) {
      return json({ ok: false, error: goalTriggered ? 'giveaway_not_open' : 'giveaway_dates_unavailable' }, 409);
    }
    if (Date.now() < starts) return json({ ok: false, error: 'giveaway_not_open' }, 409);
    if (Date.now() >= ends) return json({ ok: false, error: 'giveaway_ended' }, 409);
    if (Number(giveaway.vip_only) === 1 && !isVip(account)) return json({ ok: false, error: 'vip_membership_required' }, 403);

    const existing = await env.DB.prepare(
      'SELECT id FROM poke_prize_giveaway_entries WHERE giveaway_id = ? AND account_id = ? LIMIT 1'
    ).bind(giveawayId, account.id).first();
    if (existing) return json({ ok: false, error: 'already_entered' }, 409);

    let inserted;
    try {
      inserted = await env.DB.prepare(
        'INSERT INTO poke_prize_giveaway_entries (giveaway_id, account_id, rules_accepted_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
      ).bind(giveawayId, account.id).run();
    } catch (error) {
      if (String(error && error.message || '').toLowerCase().includes('unique')) {
        return json({ ok: false, error: 'already_entered' }, 409);
      }
      throw error;
    }
    const entryId = Number(inserted.meta?.last_row_id || 0);
    const count = await env.DB.prepare(
      'SELECT COALESCE(SUM(1 + e.bonus_entries), 0) AS total FROM poke_prize_giveaway_entries e JOIN accounts a ON a.id = e.account_id WHERE e.giveaway_id = ?'
    ).bind(giveawayId).first();
    return json({
      ok: true,
      message: 'Your entry is confirmed. Good luck!',
      entry: { id: entryId, giveaway_id: giveawayId, entered: true },
      entries: Number(count?.total || 0)
    }, 201);
  } catch (error) {
    console.error('Giveaway entry submission failed:', error);
    return json({ ok: false, error: 'giveaway_entry_failed' }, 500);
  }
}
export async function onRequest() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
