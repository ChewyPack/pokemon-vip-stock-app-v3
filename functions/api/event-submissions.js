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
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(value) {
  return base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
function clean(value, max = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T12:00:00Z'));
}
function validTime(value) {
  return !value || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
function validHttpsUrl(value) {
  if (!value) return true;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}
function originAllowed(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}
async function currentAccount(request, env) {
  const token = cookie(request, COOKIE);
  if (!token) return null;
  const account = await env.DB.prepare('SELECT id, display_name, email, is_admin, session_expires_at FROM accounts WHERE session_token_hash = ? LIMIT 1').bind(await sha256(token)).first();
  if (!account || !account.session_expires_at || Number(account.session_expires_at) <= Date.now()) return null;
  return account;
}
async function requireAdmin(request, env) {
  const account = await currentAccount(request, env);
  if (!account) return { response: json({ ok: false, error: 'login_required' }, 401) };
  if (Number(account.is_admin || 0) !== 1) return { response: json({ ok: false, error: 'admin_required' }, 403) };
  return { account };
}
async function ensureTables(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS poke_report_events (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT \'\', event_type TEXT NOT NULL DEFAULT \'show\', event_date TEXT NOT NULL, start_time TEXT NOT NULL DEFAULT \'\', end_time TEXT NOT NULL DEFAULT \'\', venue TEXT NOT NULL DEFAULT \'\', address TEXT NOT NULL DEFAULT \'\', city TEXT NOT NULL DEFAULT \'\', state TEXT NOT NULL DEFAULT \'\', state_name TEXT NOT NULL DEFAULT \'\', zip TEXT NOT NULL DEFAULT \'\', url TEXT NOT NULL DEFAULT \'\', price TEXT NOT NULL DEFAULT \'\', image_url TEXT NOT NULL DEFAULT \'\', badge TEXT NOT NULL DEFAULT \'\', status TEXT NOT NULL DEFAULT \'draft\' CHECK(status IN (\'draft\',\'published\')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_poke_report_events_public_date ON poke_report_events(status, event_date)').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS poke_prize_event_submissions (id INTEGER PRIMARY KEY AUTOINCREMENT, submitted_by_account_id INTEGER NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT \'\', event_type TEXT NOT NULL DEFAULT \'show\', event_date TEXT NOT NULL, start_time TEXT NOT NULL DEFAULT \'\', end_time TEXT NOT NULL DEFAULT \'\', venue TEXT NOT NULL DEFAULT \'\', address TEXT NOT NULL DEFAULT \'\', city TEXT NOT NULL DEFAULT \'\', state TEXT NOT NULL DEFAULT \'\', state_name TEXT NOT NULL DEFAULT \'\', zip TEXT NOT NULL DEFAULT \'\', url TEXT NOT NULL DEFAULT \'\', price TEXT NOT NULL DEFAULT \'\', status TEXT NOT NULL DEFAULT \'pending\' CHECK(status IN (\'pending\',\'approved\',\'rejected\')), review_note TEXT NOT NULL DEFAULT \'\', approved_event_id INTEGER, reviewed_by_account_id INTEGER, reviewed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_poke_prize_event_submissions_status ON poke_prize_event_submissions(status, created_at DESC)').run();
}
const TYPES = new Set(['show', 'trade', 'tournament', 'store', 'restock', 'release']);
const FIELDS = ['title','description','event_type','event_date','start_time','end_time','venue','address','city','state','state_name','zip','url','price'];
function normalize(body) {
  const result = {};
  for (const field of FIELDS) {
    const limit = field === 'description' ? 4000 : field === 'title' ? 180 : field === 'address' ? 300 : field === 'url' ? 1000 : 160;
    result[field] = clean(body[field], limit);
  }
  result.event_type = result.event_type || 'show';
  if (!result.state_name) {
    const stateNames = { RI: 'Rhode Island', MA: 'Massachusetts', CT: 'Connecticut', NH: 'New Hampshire', VT: 'Vermont', ME: 'Maine', ONLINE: 'Online / nationwide', OTHER: 'Other' };
    result.state_name = stateNames[result.state] || result.state;
  }
  return result;
}
export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  const access = await requireAdmin(request, env);
  if (access.response) return access.response;
  try {
    await ensureTables(env);
    const rows = await env.DB.prepare('SELECT s.*, a.display_name AS submitter_name, a.email AS submitter_email, p.username AS submitter_username FROM poke_prize_event_submissions s JOIN accounts a ON a.id = s.submitted_by_account_id LEFT JOIN collector_profiles p ON p.account_id = a.id ORDER BY CASE s.status WHEN \'pending\' THEN 0 ELSE 1 END, s.created_at DESC LIMIT 500').all();
    return json({ ok: true, submissions: rows.results || [] });
  } catch (error) {
    console.error('Member event submissions read failed:', error);
    return json({ ok: false, error: 'event_submissions_read_failed' }, 500);
  }
}
export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  if (!originAllowed(request)) return json({ ok: false, error: 'origin_not_allowed' }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'bad_request' }, 400); }
  try {
    await ensureTables(env);
    if (body.action === 'approve' || body.action === 'reject') {
      const access = await requireAdmin(request, env);
      if (access.response) return access.response;
      const id = Number(body.id);
      if (!Number.isSafeInteger(id) || id < 1) return json({ ok: false, error: 'valid_submission_id_required' }, 400);
      const submission = await env.DB.prepare('SELECT * FROM poke_prize_event_submissions WHERE id = ? LIMIT 1').bind(id).first();
      if (!submission) return json({ ok: false, error: 'submission_not_found' }, 404);
      if (submission.status !== 'pending') return json({ ok: false, error: 'submission_already_reviewed' }, 409);
      if (body.action === 'reject') {
        const note = clean(body.reason, 500);
        const result = await env.DB.prepare('UPDATE poke_prize_event_submissions SET status = \'rejected\', review_note = ?, reviewed_by_account_id = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = \'pending\'').bind(note, access.account.id, id).run();
        if (Number(result.meta?.changes || 0) !== 1) return json({ ok: false, error: 'submission_already_reviewed' }, 409);
        return json({ ok: true, status: 'rejected' });
      }
      const event = await env.DB.prepare('INSERT INTO poke_report_events (title,description,event_type,event_date,start_time,end_time,venue,address,city,state,state_name,zip,url,price,image_url,badge,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,\'published\')').bind(submission.title,submission.description,submission.event_type,submission.event_date,submission.start_time,submission.end_time,submission.venue,submission.address,submission.city,submission.state,submission.state_name,submission.zip,submission.url,submission.price,'','Community submission').run();
      const eventId = Number(event.meta?.last_row_id || 0);
      const saved = await env.DB.prepare('UPDATE poke_prize_event_submissions SET status = \'approved\', approved_event_id = ?, reviewed_by_account_id = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = \'pending\'').bind(eventId, access.account.id, id).run();
      if (Number(saved.meta?.changes || 0) !== 1) {
        console.error('Event submission was published but its review state did not update.', { submissionId: id, eventId });
        return json({ ok: false, error: 'submission_review_state_failed', message: 'The event was published, but the submission status did not update. Check the admin review queue before retrying.' }, 500);
      }
      return json({ ok: true, status: 'approved', event_id: eventId });
    }
    const account = await currentAccount(request, env);
    if (!account) return json({ ok: false, error: 'login_required' }, 401);
    const data = normalize(body);
    if (!data.title || data.title.length < 4) return json({ ok: false, error: 'title_required' }, 400);
    if (!validDate(data.event_date)) return json({ ok: false, error: 'valid_event_date_required' }, 400);
    if (!TYPES.has(data.event_type)) return json({ ok: false, error: 'invalid_event_type' }, 400);
    if (!validTime(data.start_time) || !validTime(data.end_time)) return json({ ok: false, error: 'invalid_event_time' }, 400);
    if (data.url && !validHttpsUrl(data.url)) return json({ ok: false, error: 'event_url_must_be_https' }, 400);
    if (!data.venue && !data.city && !data.url) return json({ ok: false, error: 'event_location_or_url_required' }, 400);
    const result = await env.DB.prepare('INSERT INTO poke_prize_event_submissions (submitted_by_account_id,title,description,event_type,event_date,start_time,end_time,venue,address,city,state,state_name,zip,url,price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(account.id,data.title,data.description,data.event_type,data.event_date,data.start_time,data.end_time,data.venue,data.address,data.city,data.state,data.state_name,data.zip,data.url,data.price).run();
    return json({ ok: true, submission: { id: Number(result.meta?.last_row_id || 0), status: 'pending' }, message: 'Your event was submitted for review. It will appear on the calendar after approval.' }, 201);
  } catch (error) {
    console.error('Member event submission failed:', error);
    return json({ ok: false, error: 'event_submission_failed' }, 500);
  }
}
export async function onRequest() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
