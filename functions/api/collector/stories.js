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
function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(value) {
  return base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
async function currentAccount(request, env) {
  const token = cookie(request, COOKIE);
  if (!token) return null;
  const account = await env.DB.prepare('SELECT id,session_expires_at FROM accounts WHERE session_token_hash=? LIMIT 1').bind(await sha256(token)).first();
  return account && account.session_expires_at && Number(account.session_expires_at) > Date.now() ? account : null;
}
async function ensureProfile(env, accountId) {
  let profile = await env.DB.prepare('SELECT username FROM collector_profiles WHERE account_id=? LIMIT 1').bind(accountId).first();
  if (profile) return profile;
  const account = await env.DB.prepare('SELECT display_name FROM accounts WHERE id=? LIMIT 1').bind(accountId).first();
  const base = String(account?.display_name || 'collector').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 18) || 'collector';
  let username = base.length >= 3 ? base : 'collector' + String(accountId);
  const existing = await env.DB.prepare('SELECT id FROM collector_profiles WHERE username=? COLLATE NOCASE LIMIT 1').bind(username).first();
  if (existing) username = (username.slice(0, 18) + String(accountId)).slice(0, 24);
  await env.DB.prepare("INSERT OR IGNORE INTO collector_profiles(account_id,username,bio,avatar_url,cover_url,is_public) VALUES(?,?, '', '', '', 1)").bind(accountId, username).run();
  return env.DB.prepare('SELECT username FROM collector_profiles WHERE account_id=? LIMIT 1').bind(accountId).first();
}
function cleanStoryMediaUrl(value, accountId, requestUrl, expectedType) {
  if (typeof value !== 'string' || !value || value.length > 1000) return null;
  try {
    const parsed = new URL(value, requestUrl);
    if (parsed.origin !== new URL(requestUrl).origin || parsed.pathname !== '/api/vendor/image') return null;
    const key = parsed.searchParams.get('key') || '';
    const prefix = 'collectors/' + Number(accountId) + '/story/';
    if (!key.startsWith(prefix)) return null;
    const match = /^[0-9a-f-]{36}\.(jpg|png|webp|avif|mp4|webm)$/i.exec(key.slice(prefix.length));
    if (!match) return null;
    const type = /\.(mp4|webm)$/i.test(match[0]) ? 'video' : 'image';
    if (type !== expectedType) return null;
    return '/api/vendor/image?key=' + encodeURIComponent(key);
  } catch (_) { return null; }
}
function migrationError(error) {
  return String(error?.message || '').toLowerCase().includes('no such table');
}

export async function onRequestGet({request, env}) {
  if (!env.DB) return json({ok:false,error:'database_not_configured'}, 500);
  try {
    await env.DB.prepare('DELETE FROM collector_stories WHERE expires_at<=CURRENT_TIMESTAMP AND is_highlighted=0').run();
    const viewer = await currentAccount(request, env).catch(() => null);
    const viewerId = viewer ? viewer.id : null;
    const result = await env.DB.prepare(
      'SELECT s.id,s.account_id,s.media_type,s.media_url,s.caption,s.created_at,s.expires_at,s.is_highlighted,' +
      'p.username,p.avatar_url,a.display_name,' +
      '(SELECT COUNT(*) FROM collector_story_views v WHERE v.story_id=s.id) AS view_count,' +
      'CASE WHEN ? IS NOT NULL AND EXISTS(SELECT 1 FROM collector_story_views v WHERE v.story_id=s.id AND v.viewer_account_id=?) THEN 1 ELSE 0 END AS viewed_by_me,' +
      'CASE WHEN ? IS NOT NULL AND ?=s.account_id THEN 1 ELSE 0 END AS is_own ' +
      'FROM collector_stories s JOIN collector_profiles p ON p.account_id=s.account_id JOIN accounts a ON a.id=s.account_id ' +
      'WHERE (s.expires_at>CURRENT_TIMESTAMP OR s.is_highlighted=1) AND p.is_public=1 ' +
      'AND (? IS NULL OR NOT EXISTS(SELECT 1 FROM collector_blocks b WHERE (b.blocker_account_id=? AND b.blocked_account_id=s.account_id) OR (b.blocker_account_id=s.account_id AND b.blocked_account_id=?))) ' +
      'ORDER BY s.created_at DESC,s.id DESC LIMIT 300'
    ).bind(viewerId,viewerId,viewerId,viewerId,viewerId,viewerId,viewerId).all();
    return json({ok:true,stories:(result.results || []).map(row => ({
      id:Number(row.id),account_id:Number(row.account_id),media_type:row.media_type,media_url:row.media_url,
      caption:row.caption || '',created_at:row.created_at,expires_at:row.expires_at,is_highlighted:Number(row.is_highlighted || 0)===1,
      username:row.username,display_name:row.display_name || row.username,avatar_url:row.avatar_url || '',
      view_count:Number(row.view_count || 0),viewed_by_me:Number(row.viewed_by_me || 0)===1,is_own:Number(row.is_own || 0)===1
    }))});
  } catch (error) {
    console.error('Collector stories read failed:', error);
    return json({ok:false,error:migrationError(error)?'collector_stories_migration_required':'collector_stories_read_failed'}, 500);
  }
}

export async function onRequestPost({request, env}) {
  if (!env.DB) return json({ok:false,error:'database_not_configured'}, 500);
  const account = await currentAccount(request, env).catch(() => null);
  if (!account) return json({ok:false,error:'login_required'}, 401);
  let data;
  try { data = await request.json(); } catch (_) { return json({ok:false,error:'invalid_json'}, 400); }
  const mediaType = data.media_type === 'video' ? 'video' : data.media_type === 'image' ? 'image' : '';
  if (!mediaType) return json({ok:false,error:'invalid_story_media_type'}, 400);
  const mediaUrl = cleanStoryMediaUrl(data.media_url, account.id, request.url, mediaType);
  if (!mediaUrl) return json({ok:false,error:'invalid_story_media_url'}, 400);
  const caption = typeof data.caption === 'string' ? data.caption.trim() : '';
  if (caption.length > 180) return json({ok:false,error:'story_caption_too_long'}, 400);
  try {
    await ensureProfile(env, account.id);
    const result = await env.DB.prepare(
      "INSERT INTO collector_stories(account_id,media_type,media_url,caption,expires_at) VALUES(?,?,?,?,datetime('now','+24 hours'))"
    ).bind(account.id,mediaType,mediaUrl,caption).run();
    return json({ok:true,id:Number(result.meta?.last_row_id || 0),expires_in_hours:24}, 201);
  } catch (error) {
    console.error('Collector story create failed:', error);
    return json({ok:false,error:migrationError(error)?'collector_stories_migration_required':'collector_story_create_failed'}, 500);
  }
}

export async function onRequestPatch({request, env}) {
  if (!env.DB) return json({ok:false,error:'database_not_configured'}, 500);
  const account = await currentAccount(request, env).catch(() => null);
  if (!account) return json({ok:false,error:'login_required'}, 401);
  let data;
  try { data = await request.json(); } catch (_) { return json({ok:false,error:'invalid_json'}, 400); }
  const id = Number(data.id);
  if (!Number.isSafeInteger(id) || id < 1) return json({ok:false,error:'invalid_story_id'}, 400);
  try {
    if (data.action === 'highlight') {
      const highlighted = data.highlighted === true ? 1 : 0;
      const result = await env.DB.prepare('UPDATE collector_stories SET is_highlighted=? WHERE id=? AND account_id=?').bind(highlighted,id,account.id).run();
      if (!result.meta || !result.meta.changes) return json({ok:false,error:'story_not_found'}, 404);
      return json({ok:true,is_highlighted:highlighted===1});
    }
    await env.DB.prepare(
      'INSERT OR IGNORE INTO collector_story_views(story_id,viewer_account_id) ' +
      'SELECT s.id,? FROM collector_stories s JOIN collector_profiles p ON p.account_id=s.account_id ' +
      'WHERE s.id=? AND (s.expires_at>CURRENT_TIMESTAMP OR s.is_highlighted=1) AND p.is_public=1 AND s.account_id<>? ' +
      'AND NOT EXISTS(SELECT 1 FROM collector_blocks b WHERE (b.blocker_account_id=? AND b.blocked_account_id=s.account_id) OR (b.blocker_account_id=s.account_id AND b.blocked_account_id=?))'
    ).bind(account.id,id,account.id,account.id,account.id).run();
    return json({ok:true});
  } catch (error) {
    console.error('Collector story view update failed:', error);
    return json({ok:false,error:migrationError(error)?'collector_stories_migration_required':'collector_story_view_failed'}, 500);
  }
}

export async function onRequestDelete({request, env}) {
  if (!env.DB) return json({ok:false,error:'database_not_configured'}, 500);
  const account = await currentAccount(request, env).catch(() => null);
  if (!account) return json({ok:false,error:'login_required'}, 401);
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isSafeInteger(id) || id < 1) return json({ok:false,error:'invalid_story_id'}, 400);
  try {
    const result = await env.DB.prepare('DELETE FROM collector_stories WHERE id=? AND account_id=?').bind(id,account.id).run();
    if (!result.meta || !result.meta.changes) return json({ok:false,error:'story_not_found'}, 404);
    return json({ok:true});
  } catch (error) {
    console.error('Collector story delete failed:', error);
    return json({ok:false,error:migrationError(error)?'collector_stories_migration_required':'collector_story_delete_failed'}, 500);
  }
}

export async function onRequest() {
  return json({ok:false,error:'method_not_allowed'}, 405);
}
