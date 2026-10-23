const COOKIE = 'collector_session';
const IMAGE_LIMIT = 5 * 1024 * 1024;
const VIDEO_LIMIT = 25 * 1024 * 1024;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
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
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(value) {
  return base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
async function currentAccount(request, env) {
  const token = cookie(request, COOKIE);
  if (!token) return null;
  const account = await env.DB.prepare('SELECT id, is_admin, session_expires_at FROM accounts WHERE session_token_hash = ? LIMIT 1')
    .bind(await sha256(token)).first();
  if (!account || !account.session_expires_at || Number(account.session_expires_at) <= Date.now()) return null;
  return account;
}
function originAllowed(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}
async function ensureEventColumns(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS poke_report_events (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',event_type TEXT NOT NULL DEFAULT 'show',event_date TEXT NOT NULL,start_time TEXT NOT NULL DEFAULT '',end_time TEXT NOT NULL DEFAULT '',venue TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',city TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT '',state_name TEXT NOT NULL DEFAULT '',zip TEXT NOT NULL DEFAULT '',url TEXT NOT NULL DEFAULT '',price TEXT NOT NULL DEFAULT '',image_url TEXT NOT NULL DEFAULT '',badge TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),details TEXT NOT NULL DEFAULT '',media_json TEXT NOT NULL DEFAULT '[]',owner_account_id INTEGER,source_submission_id INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  const columns = await env.DB.prepare('PRAGMA table_info(poke_report_events)').all();
  const names = new Set((columns.results || []).map(column => column.name));
  for (const [name, sql] of [
    ['details', "ALTER TABLE poke_report_events ADD COLUMN details TEXT NOT NULL DEFAULT ''"],
    ['media_json', "ALTER TABLE poke_report_events ADD COLUMN media_json TEXT NOT NULL DEFAULT '[]'"],
    ['owner_account_id', 'ALTER TABLE poke_report_events ADD COLUMN owner_account_id INTEGER'],
    ['source_submission_id', 'ALTER TABLE poke_report_events ADD COLUMN source_submission_id INTEGER']
  ]) {
    if (!names.has(name)) {
      try { await env.DB.prepare(sql).run(); }
      catch (error) { if (!String(error && error.message || '').toLowerCase().includes('duplicate column')) throw error; }
    }
  }
}
function signatureMatches(type, bytes) {
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (type === 'image/webp') return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (type === 'image/avif') {
    const probe = String.fromCharCode(...bytes.slice(4, 32));
    return probe.includes('ftyp') && (probe.includes('avif') || probe.includes('avis'));
  }
  if (type === 'video/mp4') return bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp';
  if (type === 'video/webm') return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  return false;
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  if (!env.VENDOR_MEDIA) return json({ ok: false, error: 'event_media_storage_not_configured' }, 503);
  if (!originAllowed(request)) return json({ ok: false, error: 'origin_not_allowed' }, 403);
  try {
    const account = await currentAccount(request, env);
    if (!account) return json({ ok: false, error: 'login_required' }, 401);
    await ensureEventColumns(env);

    const form = await request.formData();
    const eventId = Number(form.get('event_id'));
    const file = form.get('file');
    if (!Number.isSafeInteger(eventId) || eventId < 1 || !file || typeof file.arrayBuffer !== 'function') {
      return json({ ok: false, error: 'event_and_file_required' }, 400);
    }
    const event = await env.DB.prepare('SELECT id,status,owner_account_id FROM poke_report_events WHERE id = ? LIMIT 1').bind(eventId).first();
    if (!event || (event.status !== 'published' && Number(account.is_admin || 0) !== 1)) {
      return json({ ok: false, error: 'event_not_found' }, 404);
    }
    if (Number(account.is_admin || 0) !== 1 && Number(event.owner_account_id) !== Number(account.id)) {
      return json({ ok: false, error: 'event_edit_forbidden' }, 403);
    }

    const type = String(file.type || '').toLowerCase();
    const formats = {
      'image/jpeg': ['jpg', IMAGE_LIMIT, 'image'],
      'image/png': ['png', IMAGE_LIMIT, 'image'],
      'image/webp': ['webp', IMAGE_LIMIT, 'image'],
      'image/avif': ['avif', IMAGE_LIMIT, 'image'],
      'video/mp4': ['mp4', VIDEO_LIMIT, 'video'],
      'video/webm': ['webm', VIDEO_LIMIT, 'video']
    };
    const format = formats[type];
    if (!format) return json({ ok: false, error: 'unsupported_media_type' }, 415);
    if (Number(file.size || 0) < 1 || Number(file.size || 0) > format[1]) {
      return json({ ok: false, error: format[2] === 'video' ? 'video_too_large' : 'image_too_large' }, 413);
    }

    const data = await file.arrayBuffer();
    const header = new Uint8Array(data.slice(0, 32));
    if (!signatureMatches(type, header)) return json({ ok: false, error: 'media_file_type_did_not_match' }, 415);

    const key = 'events/' + crypto.randomUUID() + '.' + format[0];
    await env.VENDOR_MEDIA.put(key, data, {
      httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' }
    });
    return json({
      ok: true,
      media: {
        type: format[2],
        url: '/api/vendor/image?key=' + encodeURIComponent(key),
        caption: String(file.name || '').slice(0, 240)
      }
    }, 201);
  } catch (error) {
    console.error('Event media upload failed:', error);
    return json({ ok: false, error: 'event_media_upload_failed' }, 500);
  }
}
export async function onRequest() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
