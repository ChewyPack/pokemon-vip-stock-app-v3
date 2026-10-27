import { ensureVendorEventSalesVerificationSchema, getVendorEventSalesPermission } from '../_lib/vendor-event-sales-verification.js';

const COOKIE = 'collector_session';
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = MAX_FILE_BYTES * 3;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
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
function clean(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function originAllowed(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
async function currentAccount(request, env) {
  const token = cookie(request, COOKIE);
  if (!token) return null;
  const account = await env.DB.prepare(
    'SELECT id,display_name,email,is_admin,session_expires_at FROM accounts WHERE session_token_hash=? LIMIT 1'
  ).bind(await sha256(token)).first();
  return account && account.session_expires_at && Number(account.session_expires_at) > Date.now() ? account : null;
}
async function requireAdmin(request, env) {
  const account = await currentAccount(request, env);
  if (!account) return { response: json({ ok: false, error: 'login_required' }, 401) };
  if (Number(account.is_admin || 0) !== 1) return { response: json({ ok: false, error: 'admin_required' }, 403) };
  return { account };
}
function extensionFor(type) {
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' })[type] || '';
}
function validSignature(type, bytes) {
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (type === 'image/webp') return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (type === 'image/avif') {
    const probe = String.fromCharCode(...bytes.slice(0, 96));
    return probe.includes('ftyp') && (probe.includes('avif') || probe.includes('avis'));
  }
  return false;
}
function validImageFile(file) {
  return !!file && typeof file.arrayBuffer === 'function' && Number(file.size) > 0 &&
    Number(file.size) <= MAX_FILE_BYTES && IMAGE_TYPES.has(String(file.type || '').toLowerCase().split(';')[0]);
}
function verificationRowForResponse(row) {
  return {
    id: Number(row.id), account_id: Number(row.account_id), status: String(row.status || 'pending'),
    review_note: String(row.review_note || ''), submitted_at: row.submitted_at || null,
    reviewed_at: row.reviewed_at || null, reviewed_by_account_id: row.reviewed_by_account_id || null,
    has_documents: !!(row.id_front_key && row.id_back_key && row.selfie_key)
  };
}
async function serveDocument(request, env, url) {
  const access = await requireAdmin(request, env);
  if (access.response) return access.response;
  if (!env.VENDOR_VERIFICATION_PRIVATE) return json({ ok: false, error: 'private_verification_storage_not_configured' }, 503);
  const verificationId = Number(url.searchParams.get('verification_id') || 0);
  const document = clean(url.searchParams.get('document'), 30);
  const keyByDocument = { id_front: ['id_front_key', 'id_front_type'], id_back: ['id_back_key', 'id_back_type'], selfie: ['selfie_key', 'selfie_type'] };
  if (!Number.isSafeInteger(verificationId) || verificationId < 1 || !keyByDocument[document]) return json({ ok: false, error: 'valid_document_required' }, 400);
  const row = await env.DB.prepare('SELECT status,id_front_key,id_front_type,id_back_key,id_back_type,selfie_key,selfie_type FROM vendor_event_sales_verifications WHERE id=? LIMIT 1').bind(verificationId).first();
  if (!row || row.status !== 'pending') return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const [keyColumn, typeColumn] = keyByDocument[document];
  const key = row[keyColumn];
  if (!key || !String(key).startsWith('vendor-verification/')) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const object = await env.VENDOR_VERIFICATION_PRIVATE.get(key);
  if (!object) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const contentType = IMAGE_TYPES.has(String(row[typeColumn] || '').toLowerCase()) ? String(row[typeColumn]).toLowerCase() : 'application/octet-stream';
  return new Response(object.body, {
    headers: {
      'content-type': contentType,
      'content-disposition': 'inline; filename="verification-document.' + (extensionFor(contentType) || 'bin') + '"',
      'cache-control': 'private, no-store, max-age=0',
      'pragma': 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer'
    }
  });
}
async function reviewVerification(request, env, body, reviewer) {
  const id = Number(body.verification_id || 0);
  const decision = clean(body.decision, 20);
  const note = clean(body.review_note, 500);
  if (!Number.isSafeInteger(id) || id < 1) return json({ ok: false, error: 'valid_verification_id_required' }, 400);
  if (!['approved', 'rejected'].includes(decision)) return json({ ok: false, error: 'invalid_review_decision' }, 400);
  const row = await env.DB.prepare('SELECT id,account_id,status,id_front_key,id_back_key,selfie_key FROM vendor_event_sales_verifications WHERE id=? LIMIT 1').bind(id).first();
  if (!row) return json({ ok: false, error: 'verification_not_found' }, 404);
  if (row.status !== 'pending') return json({ ok: false, error: 'verification_already_reviewed' }, 409);
  const keys = [row.id_front_key, row.id_back_key, row.selfie_key].filter(key => typeof key === 'string' && key.startsWith('vendor-verification/'));
  if (keys.length && !env.VENDOR_VERIFICATION_PRIVATE) return json({ ok: false, error: 'private_verification_storage_not_configured' }, 503);
  try {
    if (env.VENDOR_VERIFICATION_PRIVATE) {
      await Promise.all(keys.map(key => env.VENDOR_VERIFICATION_PRIVATE.delete(key)));
    }
  } catch (error) {
    console.error('Private verification document deletion failed:', String(error?.message || error).slice(0, 160));
    return json({ ok: false, error: 'verification_document_cleanup_failed', message: 'The decision was not saved because the private document cleanup did not complete. Please retry.' }, 503);
  }
  const saved = await env.DB.prepare(
    "UPDATE vendor_event_sales_verifications SET status=?,review_note=?,reviewed_at=CURRENT_TIMESTAMP,reviewed_by_account_id=?,id_front_key=NULL,id_front_type=NULL,id_back_key=NULL,id_back_type=NULL,selfie_key=NULL,selfie_type=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'"
  ).bind(decision, note, reviewer.id, id).run();
  if (Number(saved.meta?.changes || 0) !== 1) return json({ ok: false, error: 'verification_already_reviewed' }, 409);
  return json({ ok: true, status: decision, documents_deleted: true });
}
export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 503);
  await ensureVendorEventSalesVerificationSchema(env);
  const url = new URL(request.url);
  if (url.searchParams.has('document')) return serveDocument(request, env, url);
  if (url.searchParams.get('admin') === '1') {
    const access = await requireAdmin(request, env);
    if (access.response) return access.response;
    const rows = await env.DB.prepare(
      "SELECT v.id,v.account_id,v.status,v.review_note,v.submitted_at,v.reviewed_at,v.reviewed_by_account_id,v.id_front_key,v.id_back_key,v.selfie_key,a.display_name,a.email,a.membership_status,a.membership_tier,a.membership_entitlement_tier FROM vendor_event_sales_verifications v JOIN accounts a ON a.id=v.account_id ORDER BY CASE v.status WHEN 'pending' THEN 0 ELSE 1 END,v.submitted_at DESC LIMIT 500"
    ).all();
    const verifications = (rows.results || []).map(row => ({
      ...verificationRowForResponse(row),
      display_name: String(row.display_name || 'Member'),
      email: String(row.email || ''),
      membership_status: String(row.membership_status || ''),
      membership_tier: String(row.membership_entitlement_tier || row.membership_tier || 'free')
    }));
    return json({ ok: true, storage_configured: !!env.VENDOR_VERIFICATION_PRIVATE, verifications });
  }
  const account = await currentAccount(request, env);
  if (!account) return json({ ok: false, error: 'login_required' }, 401);
  const permission = await getVendorEventSalesPermission(env, account.id);
  const verification = await env.DB.prepare(
    'SELECT id,status,review_note,submitted_at,reviewed_at FROM vendor_event_sales_verifications WHERE account_id=? LIMIT 1'
  ).bind(account.id).first();
  return json({
    ok: true,
    account: { display_name: account.display_name || '', is_admin: Number(account.is_admin || 0) === 1 },
    ...permission,
    verification_id: verification ? Number(verification.id) : null,
    storage_configured: !!env.VENDOR_VERIFICATION_PRIVATE
  });
}
export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 503);
  if (!originAllowed(request)) return json({ ok: false, error: 'origin_not_allowed' }, 403);
  await ensureVendorEventSalesVerificationSchema(env);
  const contentType = String(request.headers.get('Content-Type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    const access = await requireAdmin(request, env);
    if (access.response) return access.response;
    const body = await request.json().catch(() => null);
    if (!body || body.action !== 'review') return json({ ok: false, error: 'bad_request' }, 400);
    return reviewVerification(request, env, body, access.account);
  }
  const account = await currentAccount(request, env);
  if (!account) return json({ ok: false, error: 'login_required' }, 401);
  const permission = await getVendorEventSalesPermission(env, account.id);
  if (!permission.is_vendor_plus) return json({ ok: false, error: 'vendor_plus_required', message: 'An active Vendor+ membership is required to request event sales permission.' }, 403);
  if (permission.verification_status === 'approved') return json({ ok: false, error: 'verification_already_approved', message: 'Your event sales permission is already approved.' }, 409);
  if (permission.verification_status === 'pending') return json({ ok: false, error: 'verification_already_pending', message: 'Your documents are already waiting for review. You can resubmit after the review decision.' }, 409);
  if (!env.VENDOR_VERIFICATION_PRIVATE) return json({ ok: false, error: 'private_verification_storage_not_configured', message: 'Secure identity upload is not available yet. Please try again later or contact PokePrizePool support.' }, 503);
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_TOTAL_BYTES + 1024 * 1024) return json({ ok: false, error: 'upload_too_large', message: 'Each image must be 8 MB or smaller.' }, 413);
  const form = await request.formData().catch(() => null);
  if (!form) return json({ ok: false, error: 'bad_request' }, 400);
  const files = [
    { field: 'id_front', label: 'ID front' },
    { field: 'id_back', label: 'ID back' },
    { field: 'selfie', label: 'Selfie' }
  ].map(item => ({ ...item, file: form.get(item.field) }));
  for (const item of files) {
    if (!validImageFile(item.file)) return json({ ok: false, error: 'invalid_verification_image', message: item.label + ' must be a JPG, PNG, WebP, or AVIF image no larger than 8 MB.' }, 400);
  }
  const uploaded = [];
  try {
    for (const item of files) {
      const type = String(item.file.type || '').toLowerCase().split(';')[0];
      const ext = extensionFor(type);
      const bytes = new Uint8Array(await item.file.arrayBuffer());
      if (!validSignature(type, bytes)) return json({ ok: false, error: 'invalid_verification_image_signature', message: item.label + ' file content does not match its image type.' }, 415);
      const key = 'vendor-verification/' + Number(account.id) + '/' + crypto.randomUUID() + '.' + ext;
      await env.VENDOR_VERIFICATION_PRIVATE.put(key, bytes, { httpMetadata: { contentType: type, cacheControl: 'private, no-store, max-age=0' } });
      uploaded.push({ field: item.field, key, type });
    }
    const byField = Object.fromEntries(uploaded.map(item => [item.field, item]));
    const result = await env.DB.prepare(
      "INSERT INTO vendor_event_sales_verifications (account_id,status,id_front_key,id_front_type,id_back_key,id_back_type,selfie_key,selfie_type,review_note,submitted_at,reviewed_at,reviewed_by_account_id,updated_at) VALUES (?,'pending',?,?,?,?,?,?, '',CURRENT_TIMESTAMP,NULL,NULL,CURRENT_TIMESTAMP) ON CONFLICT(account_id) DO UPDATE SET status='pending',id_front_key=excluded.id_front_key,id_front_type=excluded.id_front_type,id_back_key=excluded.id_back_key,id_back_type=excluded.id_back_type,selfie_key=excluded.selfie_key,selfie_type=excluded.selfie_type,review_note='',submitted_at=CURRENT_TIMESTAMP,reviewed_at=NULL,reviewed_by_account_id=NULL,updated_at=CURRENT_TIMESTAMP"
    ).bind(account.id, byField.id_front.key, byField.id_front.type, byField.id_back.key, byField.id_back.type, byField.selfie.key, byField.selfie.type).run();
    if (!Number(result.meta?.changes || 0)) throw new Error('verification_save_failed');
    return json({ ok: true, status: 'pending', message: 'Your documents were uploaded securely and submitted for PokePrizePool review.' }, 201);
  } catch (error) {
    await Promise.all(uploaded.map(item => env.VENDOR_VERIFICATION_PRIVATE.delete(item.key).catch(() => {})));
    console.error('Vendor event sales verification submission failed:', String(error?.message || error).slice(0, 180));
    return json({ ok: false, error: 'verification_submission_failed', message: 'The documents could not be submitted. Please try again.' }, 500);
  }
}
export async function onRequest() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
