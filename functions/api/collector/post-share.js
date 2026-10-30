import { ensureCollectorPostShares } from '../../_lib/collector-post-shares.js';

const COOKIE = 'collector_session';
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
}
function cookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const value = part.trim();
    if (value.startsWith(name + '=')) return value.slice(name.length + 1);
  }
  return '';
}
function b64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
}
async function sha256(value) {
  return b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
async function currentAccount(request, env) {
  const token = cookie(request, COOKIE);
  if (!token) return null;
  const account = await env.DB.prepare('SELECT id, session_expires_at FROM accounts WHERE session_token_hash = ? LIMIT 1').bind(await sha256(token)).first();
  return account && account.session_expires_at && Number(account.session_expires_at) > Date.now() ? account : null;
}
async function visiblePost(env, id, viewerId) {
  return env.DB.prepare(`SELECT p.id
    FROM collector_posts p
    JOIN collector_profiles cp ON cp.account_id = p.account_id
    WHERE p.id = ? AND p.deleted_at IS NULL AND cp.is_public = 1
      AND (? IS NULL OR NOT EXISTS (
        SELECT 1 FROM collector_blocks b
        WHERE (b.blocker_account_id = ? AND b.blocked_account_id = p.account_id)
           OR (b.blocker_account_id = p.account_id AND b.blocked_account_id = ?)
      ))
    LIMIT 1`).bind(id, viewerId, viewerId, viewerId).first();
}
export async function onRequestPost({request, env}) {
  if (!env.DB) return json({ok:false,error:'database_not_configured'}, 500);
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isSafeInteger(id) || id < 1) return json({ok:false,error:'invalid_post_id'}, 400);
  let data;
  try { data = await request.json(); } catch (_) { return json({ok:false,error:'invalid_json'}, 400); }
  const shareId = typeof data.share_id === 'string' ? data.share_id.toLowerCase() : '';
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(shareId)) {
    return json({ok:false,error:'invalid_share_id'}, 400);
  }
  try {
    await ensureCollectorPostShares(env.DB);
    const viewer = await currentAccount(request, env).catch(() => null);
    if (!await visiblePost(env, id, viewer?.id ?? null)) return json({ok:false,error:'post_not_found'}, 404);
    const shareKeyHash = await sha256(shareId);
    const inserted = await env.DB.prepare('INSERT OR IGNORE INTO collector_post_shares(post_id,share_key_hash) VALUES(?,?)')
      .bind(id, shareKeyHash).run();
    const result = await env.DB.prepare('SELECT COUNT(*) AS count FROM collector_post_shares WHERE post_id = ?').bind(id).first();
    return json({ok:true,counted:Number(inserted.meta?.changes || 0) > 0,share_count:Number(result?.count || 0)});
  } catch (error) {
    console.error('Post share tracking failed:', error);
    return json({ok:false,error:'post_share_tracking_failed'}, 500);
  }
}
export async function onRequest() {
  return json({ok:false,error:'method_not_allowed'}, 405);
}
