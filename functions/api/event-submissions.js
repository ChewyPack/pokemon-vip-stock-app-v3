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
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS poke_prize_event_submissions (id INTEGER PRIMARY KEY AUTOINCREMENT, submitted_by_account_id INTEGER NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT \'\', event_type TEXT NOT NULL DEFAULT \'show\', event_date TEXT NOT NULL, start_time TEXT NOT NULL DEFAULT \'\', end_time TEXT NOT NULL DEFAULT \'\', venue TEXT NOT NULL DEFAULT \'\', address TEXT NOT NULL DEFAULT \'\', city TEXT NOT NULL DEFAULT \'\', state TEXT NOT NULL DEFAULT \'\', state_name TEXT NOT NULL DEFAULT \'\', zip TEXT NOT NULL DEFAULT \'\', url TEXT NOT NULL DEFAULT \'\', price TEXT NOT NULL DEFAULT \'\', recurrence_frequency TEXT NOT NULL DEFAULT \'once\', recurrence_until TEXT NOT NULL DEFAULT \'\', status TEXT NOT NULL DEFAULT \'pending\' CHECK(status IN (\'pending\',\'approved\',\'rejected\')), review_note TEXT NOT NULL DEFAULT \'\', approved_event_id INTEGER, reviewed_by_account_id INTEGER, reviewed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run();
  const submissionColumns = await env.DB.prepare('PRAGMA table_info(poke_prize_event_submissions)').all();
  const submissionNames = new Set((submissionColumns.results || []).map(column => column.name));
  if (!submissionNames.has('recurrence_frequency')) {
    try { await env.DB.prepare("ALTER TABLE poke_prize_event_submissions ADD COLUMN recurrence_frequency TEXT NOT NULL DEFAULT 'once'").run(); }
    catch (error) { if (!String(error && error.message || '').toLowerCase().includes('duplicate column')) throw error; }
  }
  if (!submissionNames.has('recurrence_until')) {
    try { await env.DB.prepare("ALTER TABLE poke_prize_event_submissions ADD COLUMN recurrence_until TEXT NOT NULL DEFAULT ''").run(); }
    catch (error) { if (!String(error && error.message || '').toLowerCase().includes('duplicate column')) throw error; }
  }
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_poke_prize_event_submissions_status ON poke_prize_event_submissions(status, created_at DESC)').run();
}
const TYPES = new Set(['show', 'trade', 'tournament', 'store', 'restock', 'release']);
const RECURRENCE = new Set(['once', 'weekly', 'monthly', 'yearly']);
const RECURRENCE_LIMITS = { weekly: 53, monthly: 60, yearly: 10 };
const FIELDS = ['title','description','event_type','event_date','start_time','end_time','venue','address','city','state','state_name','zip','url','price','recurrence_frequency','recurrence_until'];
function normalize(body) {
  const result = {};
  for (const field of FIELDS) {
    const limit = field === 'description' ? 4000 : field === 'title' ? 180 : field === 'address' ? 300 : field === 'url' ? 1000 : 160;
    result[field] = clean(body[field], limit);
  }
  result.event_type = result.event_type || 'show';
  result.recurrence_frequency = result.recurrence_frequency || 'once';
  result.recurrence_until = result.recurrence_until || '';
  if (!result.state_name) {
    const stateNames = { RI: 'Rhode Island', MA: 'Massachusetts', CT: 'Connecticut', NH: 'New Hampshire', VT: 'Vermont', ME: 'Maine', ONLINE: 'Online / nationwide', OTHER: 'Other' };
    result.state_name = stateNames[result.state] || result.state;
  }
  return result;
}
function recurrenceDates(startDate, frequency, untilDate) {
  if (frequency === 'once') return [startDate];
  if (!RECURRENCE.has(frequency) || !validDate(untilDate) || untilDate < startDate) return null;
  const limit = RECURRENCE_LIMITS[frequency];
  const [baseYear, baseMonth, baseDay] = startDate.split('-').map(Number);
  const results = [startDate];
  for (let index = 1; index < limit; index += 1) {
    let next;
    if (frequency === 'weekly') {
      next = new Date(Date.UTC(baseYear, baseMonth - 1, baseDay + index * 7)).toISOString().slice(0, 10);
    } else if (frequency === 'monthly') {
      const first = new Date(Date.UTC(baseYear, baseMonth - 1 + index, 1));
      const year = first.getUTCFullYear();
      const month = first.getUTCMonth();
      const day = Math.min(baseDay, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
      next = new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
    } else {
      const year = baseYear + index;
      const day = Math.min(baseDay, new Date(Date.UTC(year, baseMonth, 0)).getUTCDate());
      next = new Date(Date.UTC(year, baseMonth - 1, day)).toISOString().slice(0, 10);
    }
    if (next > untilDate) return results;
    results.push(next);
  }
  const last = results[results.length - 1];
  const lastParts = last.split('-').map(Number);
  let nextBeyond;
  if (frequency === 'weekly') {
    nextBeyond = new Date(Date.UTC(baseYear, baseMonth - 1, baseDay + limit * 7)).toISOString().slice(0, 10);
  } else if (frequency === 'monthly') {
    const first = new Date(Date.UTC(baseYear, baseMonth - 1 + limit, 1));
    const day = Math.min(baseDay, new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate());
    nextBeyond = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day)).toISOString().slice(0, 10);
  } else {
    const year = baseYear + limit;
    const day = Math.min(baseDay, new Date(Date.UTC(year, baseMonth, 0)).getUTCDate());
    nextBeyond = new Date(Date.UTC(year, baseMonth - 1, day)).toISOString().slice(0, 10);
  }
  return nextBeyond <= untilDate ? null : results;
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
      const frequency = RECURRENCE.has(submission.recurrence_frequency) ? submission.recurrence_frequency : 'once';
      const dates = recurrenceDates(submission.event_date, frequency, submission.recurrence_until || '');
      if (!dates) return json({ ok: false, error: 'recurrence_limit_exceeded', message: 'This recurring event exceeds the allowed number of dates. Ask the submitter to shorten the series.' }, 409);
      const statements = dates.map((eventDate, index) => {
        const badge = frequency === 'once' ? 'Community submission' : (frequency.charAt(0).toUpperCase() + frequency.slice(1)) + ' series ' + (index + 1) + '/' + dates.length;
        return env.DB.prepare("INSERT INTO poke_report_events (title,description,event_type,event_date,start_time,end_time,venue,address,city,state,state_name,zip,url,price,image_url,badge,status) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'published' WHERE EXISTS (SELECT 1 FROM poke_prize_event_submissions WHERE id = ? AND status = 'pending')")
          .bind(submission.title,submission.description,submission.event_type,eventDate,submission.start_time,submission.end_time,submission.venue,submission.address,submission.city,submission.state,submission.state_name,submission.zip,submission.url,submission.price,'',badge,id);
      });
      const firstBadge = frequency === 'once' ? 'Community submission' : (frequency.charAt(0).toUpperCase() + frequency.slice(1)) + ' series 1/' + dates.length;
      statements.push(env.DB.prepare("UPDATE poke_prize_event_submissions SET status = 'approved', approved_event_id = (SELECT id FROM poke_report_events WHERE title = ? AND event_date = ? AND badge = ? AND status = 'published' ORDER BY id DESC LIMIT 1), reviewed_by_account_id = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'")
        .bind(submission.title, dates[0], firstBadge, access.account.id, id));
      const reviewResults = await env.DB.batch(statements);
      if (!reviewResults.length || Number(reviewResults[0]?.meta?.changes || 0) !== 1) {
        return json({ ok: false, error: 'submission_already_reviewed' }, 409);
      }
      const eventId = Number(reviewResults[0]?.meta?.last_row_id || 0);
      const saved = reviewResults[reviewResults.length - 1];
      if (Number(saved?.meta?.changes || 0) !== 1) {
        console.error('Event submission review status did not update.', { submissionId: id });
        return json({ ok: false, error: 'submission_review_state_failed' }, 500);
      }
      return json({ ok: true, status: 'approved', event_id: eventId, occurrences_created: dates.length, message: dates.length === 1 ? 'Event approved and published.' : 'Recurring event approved. ' + dates.length + ' occurrences were added to the calendar.' });
    }
    const account = await currentAccount(request, env);
    if (!account) return json({ ok: false, error: 'login_required' }, 401);
    const data = normalize(body);
    if (!data.title || data.title.length < 4) return json({ ok: false, error: 'title_required' }, 400);
    if (!validDate(data.event_date)) return json({ ok: false, error: 'valid_event_date_required' }, 400);
    if (!TYPES.has(data.event_type)) return json({ ok: false, error: 'invalid_event_type' }, 400);
    if (!RECURRENCE.has(data.recurrence_frequency)) return json({ ok: false, error: 'invalid_recurrence_frequency' }, 400);
    if (!validTime(data.start_time) || !validTime(data.end_time)) return json({ ok: false, error: 'invalid_event_time' }, 400);
    if (data.url && !validHttpsUrl(data.url)) return json({ ok: false, error: 'event_url_must_be_https' }, 400);
    if (!data.venue && !data.city && !data.url) return json({ ok: false, error: 'event_location_or_url_required' }, 400);
    if (data.recurrence_frequency !== 'once') {
      if (!validDate(data.recurrence_until) || data.recurrence_until < data.event_date) return json({ ok: false, error: 'valid_recurrence_end_required' }, 400);
      if (!recurrenceDates(data.event_date, data.recurrence_frequency, data.recurrence_until)) return json({ ok: false, error: 'recurrence_limit_exceeded', message: 'Weekly series can contain up to 53 dates, monthly series up to 60, and yearly series up to 10.' }, 400);
    } else {
      data.recurrence_until = '';
    }
    const result = await env.DB.prepare('INSERT INTO poke_prize_event_submissions (submitted_by_account_id,title,description,event_type,event_date,start_time,end_time,venue,address,city,state,state_name,zip,url,price,recurrence_frequency,recurrence_until) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(account.id,data.title,data.description,data.event_type,data.event_date,data.start_time,data.end_time,data.venue,data.address,data.city,data.state,data.state_name,data.zip,data.url,data.price,data.recurrence_frequency,data.recurrence_until).run();
    return json({ ok: true, submission: { id: Number(result.meta?.last_row_id || 0), status: 'pending', recurrence_frequency: data.recurrence_frequency, recurrence_until: data.recurrence_until }, message: data.recurrence_frequency === 'once' ? 'Your event was submitted for review. It will appear on the calendar after approval.' : 'Your recurring event was submitted for review. Each scheduled occurrence will be added to the calendar after approval.' }, 201);
  } catch (error) {
    console.error('Member event submission failed:', error);
    return json({ ok: false, error: 'event_submission_failed' }, 500);
  }
}
export async function onRequest() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
