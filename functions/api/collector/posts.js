import { ensureCollectorPostViews } from '../../_lib/collector-post-views.js';
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
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
async function ensureCollectorProfile(env, accountId) {
  let profile = await env.DB.prepare('SELECT username FROM collector_profiles WHERE account_id=? LIMIT 1').bind(accountId).first();
  if (profile) return profile;
  const account = await env.DB.prepare('SELECT display_name FROM accounts WHERE id=? LIMIT 1').bind(accountId).first();
  let base = String(account && account.display_name || 'collector').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 18) || 'collector';
  if (base.length < 3) base = 'collector' + String(accountId);
  let username = base;
  const exists = await env.DB.prepare('SELECT id FROM collector_profiles WHERE username=? COLLATE NOCASE LIMIT 1').bind(username).first();
  if (exists) username = (base.slice(0, 18) + String(accountId)).slice(0, 24);
  await env.DB.prepare("INSERT OR IGNORE INTO collector_profiles (account_id,username,bio,avatar_url,cover_url,is_public) VALUES (?,?, '', '', '', 1)").bind(accountId, username).run();
  return await env.DB.prepare('SELECT username FROM collector_profiles WHERE account_id=? LIMIT 1').bind(accountId).first();
}
const TYPES = new Set(['status','pull','collection','trade','question','event','restock']);

const IMAGE_EXTENSIONS = new Set(['jpg','png','webp','avif']);
const VIDEO_EXTENSIONS = new Set(['mp4','webm']);

function cleanMediaUrl(value, accountId, requestUrl, expectedType) {
  if (!value) return '';
  if (typeof value !== 'string' || value.length > 1000) return null;
  try {
    const parsed = new URL(value, requestUrl);
    if (parsed.origin !== new URL(requestUrl).origin || parsed.pathname !== '/api/vendor/image') return null;
    const key = parsed.searchParams.get('key') || '';
    const prefix = 'collectors/' + Number(accountId) + '/post/';
    if (!key.startsWith(prefix)) return null;
    const match = /^([0-9a-f-]{36})\.(jpg|png|webp|avif|mp4|webm)$/i.exec(key.slice(prefix.length));
    if (!match) return null;
    const extension = match[2].toLowerCase();
    const type = VIDEO_EXTENSIONS.has(extension) ? 'video' : 'image';
    if (type !== expectedType) return null;
    return '/api/vendor/image?key=' + encodeURIComponent(key);
  } catch (_) { return null; }
}

function requestPostMedia(data, accountId, requestUrl) {
  // Backward compatibility for older clients that submit a single image_url.
  if (!Object.prototype.hasOwnProperty.call(data, 'media')) {
    const legacy = cleanMediaUrl(data.image_url || '', accountId, requestUrl, 'image');
    return legacy === null ? {error:'invalid_media_url'} : {media:legacy ? [{type:'image',url:legacy}] : []};
  }
  if (!Array.isArray(data.media) || data.media.length > 4) return {error:'post_media_limit_exceeded'};
  const media = [];
  let images = 0, videos = 0;
  const seen = new Set();
  for (const item of data.media) {
    if (!item || (item.type !== 'image' && item.type !== 'video') || typeof item.url !== 'string') return {error:'invalid_media_url'};
    if (item.type === 'image' && ++images > 3) return {error:'too_many_photos'};
    if (item.type === 'video' && ++videos > 1) return {error:'too_many_videos'};
    const url = cleanMediaUrl(item.url, accountId, requestUrl, item.type);
    if (!url) return {error:'invalid_media_url'};
    if (seen.has(url)) return {error:'duplicate_media'};
    seen.add(url);
    media.push({type:item.type,url});
  }
  return {media};
}

function storedMediaValue(media) {
  if (!media.length) return '';
  // Preserve legacy storage for a single image; multi-media posts use JSON in the same column.
  if (media.length === 1 && media[0].type === 'image') return media[0].url;
  return JSON.stringify(media);
}

function mediaFromStored(value) {
  if (!value) return [];
  const text = String(value);
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.filter(item => item && (item.type === 'image' || item.type === 'video') && typeof item.url === 'string' && item.url.length <= 1000).slice(0,4);
    } catch (_) {}
  }
  return [{type:'image',url:text}];
}

function postQueryWhere(viewerId, mode, username) {
  const params = [];
  let where = 'p.deleted_at IS NULL AND cp.is_public = 1';
  if (username) {
    where += ' AND cp.username = ? COLLATE NOCASE';
    params.push(username);
  } else if (mode === 'following') {
    where += ' AND (p.account_id = ? OR EXISTS (SELECT 1 FROM collector_follows f WHERE f.follower_account_id = ? AND f.followed_account_id = p.account_id))';
    params.push(viewerId, viewerId);
  }
  where += ' AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM collector_blocks b WHERE (b.blocker_account_id = ? AND b.blocked_account_id = p.account_id) OR (b.blocker_account_id = p.account_id AND b.blocked_account_id = ?)))';
  params.push(viewerId, viewerId, viewerId);
  return {where, params};
}

export async function onRequestGet({request, env}) {
  if (!env.DB) return json({ok:false,error:'database_not_configured'}, 500);
  try {
    await ensureCollectorPostViews(env.DB);
    const url = new URL(request.url);
    const viewer = await currentAccount(request, env).catch(() => null);
    const username = (url.searchParams.get('username') || '').trim().slice(0, 24);
    const mode = (url.searchParams.get('feed') || 'latest').toLowerCase();
    if (!username && !['latest','following','for-you'].includes(mode)) return json({ok:false,error:'invalid_feed'}, 400);
    if (!username && mode === 'following' && !viewer) return json({ok:false,error:'login_required'}, 401);
    if (username) {
      const exists = await env.DB.prepare('SELECT account_id FROM collector_profiles WHERE username = ? COLLATE NOCASE AND is_public = 1 LIMIT 1').bind(username).first();
      if (!exists) return json({ok:false,error:'profile_not_found'}, 404);
    }
    const viewerId = viewer ? viewer.id : null;
    const whereParts = postQueryWhere(viewerId, mode, username);
    const whereParams = [...whereParts.params];
    const requestedPostId = Number(url.searchParams.get('post_id') || 0);
    let whereClause = whereParts.where;
    if (Number.isSafeInteger(requestedPostId) && requestedPostId > 0) {
      whereClause += ' AND p.id = ?';
      whereParams.push(requestedPostId);
    }
    const order = mode === 'for-you' && !username
      ? '(SELECT COUNT(*) FROM collector_post_likes lx WHERE lx.post_id=p.id) * 3 + (SELECT COUNT(*) FROM collector_post_comments cx WHERE cx.post_id=p.id AND cx.deleted_at IS NULL) * 2 DESC, p.created_at DESC, p.id DESC'
      : 'p.created_at DESC, p.id DESC';
    const requestedLimit = Number(url.searchParams.get('limit') || 30);
    const limitValue = Math.min(40, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 30));
    const sql = 'SELECT p.id,p.account_id,p.body,p.post_type,p.image_url,p.created_at,p.updated_at,' +
      'cp.username,cp.avatar_url,a.display_name,' +
      '(SELECT COUNT(*) FROM collector_post_reactions l WHERE l.post_id=p.id) AS like_count,' +
      '(SELECT COUNT(*) FROM collector_post_comments c WHERE c.post_id=p.id AND c.deleted_at IS NULL) AS comment_count,' +
      '(SELECT COUNT(*) FROM collector_post_views v WHERE v.post_id=p.id) AS view_count,' +
      'CASE WHEN ? IS NOT NULL AND EXISTS (SELECT 1 FROM collector_post_reactions ml WHERE ml.post_id=p.id AND ml.account_id=?) THEN 1 ELSE 0 END AS liked_by_me, (SELECT mr.reaction FROM collector_post_reactions mr WHERE mr.post_id=p.id AND mr.account_id=? LIMIT 1) AS my_reaction,' +
      'CASE WHEN ? IS NOT NULL AND ?=p.account_id THEN 1 ELSE 0 END AS is_own ' +
      'FROM collector_posts p JOIN collector_profiles cp ON cp.account_id=p.account_id JOIN accounts a ON a.id=p.account_id ' +
      'WHERE ' + whereClause + ' ORDER BY ' + order + ' LIMIT ?';
    let result;
    try {
      result = await env.DB.prepare(sql).bind(viewerId, viewerId, viewerId, viewerId, viewerId, ...whereParams, limitValue).all();
    } catch (reactionSchemaError) {
      // Keep the feed readable until the production reaction migration is applied.
      if (!String(reactionSchemaError && reactionSchemaError.message || '').toLowerCase().includes('no such table')) throw reactionSchemaError;
      const legacySql = 'SELECT p.id,p.account_id,p.body,p.post_type,p.image_url,p.created_at,p.updated_at,' +
        'cp.username,cp.avatar_url,a.display_name,' +
        '(SELECT COUNT(*) FROM collector_post_likes l WHERE l.post_id=p.id) AS like_count,' +
        '(SELECT COUNT(*) FROM collector_post_comments c WHERE c.post_id=p.id AND c.deleted_at IS NULL) AS comment_count,' +
        '(SELECT COUNT(*) FROM collector_post_views v WHERE v.post_id=p.id) AS view_count,' +
        'CASE WHEN ? IS NOT NULL AND EXISTS (SELECT 1 FROM collector_post_likes ml WHERE ml.post_id=p.id AND ml.account_id=?) THEN 1 ELSE 0 END AS liked_by_me,' +
        'CASE WHEN ? IS NOT NULL AND ?=p.account_id THEN 1 ELSE 0 END AS is_own ' +
        'FROM collector_posts p JOIN collector_profiles cp ON cp.account_id=p.account_id JOIN accounts a ON a.id=p.account_id ' +
        'WHERE ' + whereClause + ' ORDER BY ' + order + ' LIMIT ?';
      result = await env.DB.prepare(legacySql).bind(viewerId,viewerId,viewerId,viewerId,...whereParams,limitValue).all();
    }
    const posts = (result.results || []).map(p => {
      const media = mediaFromStored(p.image_url);
      const firstImage = media.find(item => item.type === 'image');
      return {
        id:Number(p.id), body:p.body, post_type:p.post_type,
        image_url:firstImage ? firstImage.url : '', media,
        created_at:p.created_at, updated_at:p.updated_at, username:p.username,
        display_name:p.display_name || p.username, avatar_url:p.avatar_url || '',
        like_count:Number(p.like_count || 0), comment_count:Number(p.comment_count || 0), view_count:Number(p.is_own || 0) === 1 ? Number(p.view_count || 0) : 0,
        liked_by_me:Number(p.liked_by_me || 0) === 1, my_reaction:p.my_reaction || (Number(p.liked_by_me || 0) === 1 ? 'like' : ''), is_own:Number(p.is_own || 0) === 1
      };
    });
    return json({ok:true, posts, feed:username ? 'profile' : mode});
  } catch (error) {
    console.error('Collector posts read failed:', error);
    const message = String(error && error.message || '').toLowerCase();
    if (message.includes('no such table')) return json({ok:false,error:'collector_social_migration_required'}, 500);
    return json({ok:false,error:'collector_posts_read_failed'}, 500);
  }
}

export async function onRequestPost({request, env}) {
  if (!env.DB) return json({ok:false,error:'database_not_configured'}, 500);
  const account = await currentAccount(request, env).catch(() => null);
  if (!account) return json({ok:false,error:'login_required'}, 401);
  let data;
  try { data = await request.json(); } catch (_) { return json({ok:false,error:'invalid_json'}, 400); }
  const body = typeof data.body === 'string' ? data.body.trim() : '';
  const type = TYPES.has(data.post_type) ? data.post_type : 'status';
  const requestedMedia = requestPostMedia(data, account.id, request.url);
  if (requestedMedia.error) return json({ok:false,error:requestedMedia.error}, 400);
  const media = requestedMedia.media;
  const mediaValue = storedMediaValue(media);
  if (!body && !media.length) return json({ok:false,error:'post_content_required'}, 400);
  if (body.length > 2000) return json({ok:false,error:'post_too_long'}, 400);
  try {
    const profile = await ensureCollectorProfile(env, account.id);
    if (!profile) return json({ok:false,error:'collector_profile_missing'}, 400);
    const result = await env.DB.prepare('INSERT INTO collector_posts(account_id,body,post_type,image_url) VALUES(?,?,?,?)').bind(account.id, body, type, mediaValue).run();
    try { const tags=[...new Set((body.match(/(^|\\s)#[a-zA-Z0-9_]{2,30}/g)||[]).map(x=>x.trim().slice(1)))]; for (const display of tags) await env.DB.prepare(\`INSERT INTO collector_hashtags(tag,display_tag,usage_count) VALUES(?,?,1) ON CONFLICT(tag) DO UPDATE SET usage_count=collector_hashtags.usage_count+1,display_tag=excluded.display_tag,updated_at=CURRENT_TIMESTAMP\`).bind(display.toLowerCase(),display).run(); } catch (tagError) { console.error('Hashtag tracking skipped:',tagError); }
    return json({ok:true,id:Number(result.meta && result.meta.last_row_id || 0)}, 201);
  } catch (error) {
    console.error('Collector post create failed:', error);
    const message = String(error && error.message || '').toLowerCase();
    if (message.includes('no such table')) return json({ok:false,error:'collector_social_migration_required'}, 500);
    return json({ok:false,error:'collector_post_create_failed'}, 500);
  }
}

export async function onRequestPatch({request, env}) {
  if (!env.DB) return json({ok:false,error:'database_not_configured'}, 500);
  const account = await currentAccount(request, env).catch(() => null);
  if (!account) return json({ok:false,error:'login_required'}, 401);
  let data;
  try { data = await request.json(); } catch (_) { return json({ok:false,error:'invalid_json'}, 400); }
  const id = Number(data.id);
  const body = typeof data.body === 'string' ? data.body.trim() : '';
  const type = TYPES.has(data.post_type) ? data.post_type : 'status';
  const requestedMedia = requestPostMedia(data, account.id, request.url);
  if (!Number.isInteger(id) || id < 1) return json({ok:false,error:'invalid_post_id'}, 400);
  if (requestedMedia.error) return json({ok:false,error:requestedMedia.error}, 400);
  const media = requestedMedia.media;
  const mediaValue = storedMediaValue(media);
  if (!body && !media.length) return json({ok:false,error:'post_content_required'}, 400);
  if (body.length > 2000) return json({ok:false,error:'post_too_long'}, 400);
  try {
    const result = await env.DB.prepare('UPDATE collector_posts SET body=?,post_type=?,image_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND account_id=? AND deleted_at IS NULL').bind(body,type,mediaValue,id,account.id).run();
    if (!result.meta || !result.meta.changes) return json({ok:false,error:'post_not_found'}, 404);
    return json({ok:true});
  } catch (error) {
    console.error('Collector post update failed:', error);
    return json({ok:false,error:String(error && error.message || '').toLowerCase().includes('no such table')?'collector_social_migration_required':'collector_post_update_failed'}, 500);
  }
}

export async function onRequestDelete({request, env}) {
  if (!env.DB) return json({ok:false,error:'database_not_configured'}, 500);
  const account = await currentAccount(request, env).catch(() => null);
  if (!account) return json({ok:false,error:'login_required'}, 401);
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id < 1) return json({ok:false,error:'invalid_post_id'}, 400);
  try {
    const result = await env.DB.prepare('UPDATE collector_posts SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND account_id=? AND deleted_at IS NULL').bind(id,account.id).run();
    if (!result.meta || !result.meta.changes) return json({ok:false,error:'post_not_found'}, 404);
    return json({ok:true});
  } catch (error) {
    console.error('Collector post delete failed:', error);
    return json({ok:false,error:String(error && error.message || '').toLowerCase().includes('no such table')?'collector_social_migration_required':'collector_post_delete_failed'}, 500);
  }
}

export async function onRequest() { return json({ok:false,error:'method_not_allowed'}, 405); }
