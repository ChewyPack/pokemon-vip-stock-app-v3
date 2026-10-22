const COOKIE = 'collector_session';
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }); }
function cookie(request, name) { for (const part of (request.headers.get('Cookie') || '').split(';')) { const value = part.trim(); if (value.startsWith(name + '=')) return value.slice(name.length + 1); } return ''; }
function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function sha256(value) { return b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); }
async function currentAccount(request, env) {
  const token = cookie(request, COOKIE); if (!token) return null;
  const account = await env.DB.prepare('SELECT id, session_expires_at FROM accounts WHERE session_token_hash = ? LIMIT 1').bind(await sha256(token)).first();
  return account && account.session_expires_at && Number(account.session_expires_at) > Date.now() ? account : null;
}
const TYPES = new Set(['status','pull','collection','trade','question','event','restock']);
function cleanImageUrl(value, accountId) {
  if (!value) return '';
  const pattern = new RegExp('^/api/vendor/image\\?key=collectors/' + Number(accountId) + '/post/[a-f0-9-]+\\.(?:jpg|png|webp|avif)$', 'i');
  return typeof value === 'string' && value.length < 500 && pattern.test(value) ? value : null;
}
function postQueryWhere(viewerId, mode, username) {
  const params = [];
  let where = 'p.deleted_at IS NULL AND cp.is_public = 1';
  if (username) { where += ' AND cp.username = ? COLLATE NOCASE'; params.push(username); }
  else if (mode === 'following') { where += ' AND (p.account_id = ? OR EXISTS (SELECT 1 FROM collector_follows f WHERE f.follower_account_id = ? AND f.followed_account_id = p.account_id))'; params.push(viewerId, viewerId); }
  where += ' AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM collector_blocks b WHERE (b.blocker_account_id = ? AND b.blocked_account_id = p.account_id) OR (b.blocker_account_id = p.account_id AND b.blocked_account_id = ?)))';
  params.push(viewerId, viewerId, viewerId);
  return { where, params };
}
export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok:false, error:'database_not_configured' }, 500);
  try {
    const url = new URL(request.url), viewer = await currentAccount(request, env).catch(() => null);
    const username = (url.searchParams.get('username') || '').trim().slice(0, 24);
    const mode = (url.searchParams.get('feed') || 'latest').toLowerCase();
    if (!username && !['latest','following','for-you'].includes(mode)) return json({ ok:false, error:'invalid_feed' }, 400);
    if (!username && mode === 'following' && !viewer) return json({ ok:false, error:'login_required' }, 401);
    if (username) {
      const exists = await env.DB.prepare('SELECT account_id FROM collector_profiles WHERE username = ? COLLATE NOCASE AND is_public = 1 LIMIT 1').bind(username).first();
      if (!exists) return json({ ok:false, error:'profile_not_found' }, 404);
    }
    const { where, params } = postQueryWhere(viewer?.id ?? null, mode, username);
    const viewerId = viewer?.id ?? null;
    const order = mode === 'for-you' && !username
      ? '(SELECT COUNT(*) FROM collector_post_likes lx WHERE lx.post_id=p.id) * 3 + (SELECT COUNT(*) FROM collector_post_comments cx WHERE cx.post_id=p.id AND cx.deleted_at IS NULL) * 2 DESC, p.created_at DESC, p.id DESC'
      : 'p.created_at DESC, p.id DESC';
    const limitValue = Math.min(40, Math.max(1, Number(url.searchParams.get('limit') || 30) || 30));
    const result = await env.DB.prepare(`
      SELECT p.id,p.account_id,p.body,p.post_type,p.image_url,p.created_at,p.updated_at,
        cp.username,cp.avatar_url,a.display_name,
        (SELECT COUNT(*) FROM collector_post_likes l WHERE l.post_id=p.id) AS like_count,
        (SELECT COUNT(*) FROM collector_post_comments c WHERE c.post_id=p.id AND c.deleted_at IS NULL) AS comment_count,
        CASE WHEN ? IS NOT NULL AND EXISTS (SELECT 1 FROM collector_post_likes ml WHERE ml.post_id=p.id AND ml.account_id=?) THEN 1 ELSE 0 END AS liked_by_me,
        CASE WHEN ? IS NOT NULL AND ?=p.account_id THEN 1 ELSE 0 END AS is_own
      FROM collector_posts p
      JOIN collector_profiles cp ON cp.account_id=p.account_id
      JOIN accounts a ON a.id=p.account_id
      WHERE ${where}
      ORDER BY ${order}
      LIMIT ?
    `).bind(viewerId, viewerId, viewerId, viewerId, ...params, limitValue).all();
    const posts = (result.results || []).map(p => ({
      id:Number(p.id), body:p.body, post_type:p.post_type, image_url:p.image_url || '',
      created_at:p.created_at, updated_at:p.updated_at, username:p.username,
      display_name:p.display_name || p.username, avatar_url:p.avatar_url || '',
      like_count:Number(p.like_count || 0), comment_count:Number(p.comment_count || 0),
      liked_by_me:Number(p.liked_by_me || 0) === 1, is_own:Number(p.is_own || 0) === 1
    }));
    return json({ ok:true, posts, feed:username ? 'profile' : mode });
  } catch (error) {
    console.error('Collector posts read failed:', error);
    const message=String(error?.message || '').toLowerCase();
    if (message.includes('no such table')) return json({ ok:false, error:'collector_social_migration_required' }, 500);
    return json({ ok:false, error:'collector_posts_read_failed' }, 500);
  }
}
export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok:false, error:'database_not_configured' }, 500);
  const account = await currentAccount(request, env).catch(() => null);
  if (!account) return json({ ok:false, error:'login_required' }, 401);
  let data; try { data = await request.json(); } catch { return json({ ok:false, error:'invalid_json' }, 400); }
  const body = typeof data.body === 'string' ? data.body.trim() : '';
  const type = TYPES.has(data.post_type) ? data.post_type : 'status';
  const imageUrl = cleanImageUrl(data.image_url || '', account.id);
  if (imageUrl === null) return json({ ok:false, error:'invalid_image_url' }, 400);
  if (!body && !imageUrl) return json({ ok:false, error:'post_content_required' }, 400);
  if (body.length > 2000) return json({ ok:false, error:'post_too_long' }, 400);
  try {
    const profile = await env.DB.prepare('SELECT username FROM collector_profiles WHERE account_id=? LIMIT 1').bind(account.id).first();
    if (!profile) return json({ ok:false, error:'collector_profile_missing' }, 400);
    const result = await env.DB.prepare('INSERT INTO collector_posts(account_id,body,post_type,image_url) VALUES(?,?,?,?)').bind(account.id, body, type, imageUrl).run();
    return json({ ok:true, id:Number(result.meta?.last_row_id || 0) }, 201);
  } catch (error) {
    console.error('Collector post create failed:', error);
    const message=String(error?.message || '').toLowerCase();
    if (message.includes('no such table')) return json({ ok:false, error:'collector_social_migration_required' }, 500);
    return json({ ok:false, error:'collector_post_create_failed' }, 500);
  }
}
export async function onRequestPatch({ request, env }) {
  if (!env.DB) return json({ ok:false, error:'database_not_configured' }, 500);
  const account = await currentAccount(request, env).catch(() => null);
  if (!account) return json({ ok:false, error:'login_required' }, 401);
  let data; try { data = await request.json(); } catch { return json({ ok:false, error:'invalid_json' }, 400); }
  const id=Number(data.id), body=typeof data.body==='string'?data.body.trim():'', type=TYPES.has(data.post_type)?data.post_type:'status';
  if (!Number.isInteger(id) || id<1) return json({ok:false,error:'invalid_post_id'},400);
  if (!body && !data.image_url) return json({ok:false,error:'post_content_required'},400);
  if (body.length>2000) return json({ok:false,error:'post_too_long'},400);
  const imageUrl=cleanImageUrl(data.image_url||'',account.id);
  if(imageUrl===null)return json({ok:false,error:'invalid_image_url'},400);
  try { const res=await env.DB.prepare('UPDATE collector_posts SET body=?,post_type=?,image_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND account_id=? AND deleted_at IS NULL').bind(body,type,imageUrl,id,account.id).run(); if(!res.meta?.changes)return json({ok:false,error:'post_not_found'},404); return json({ok:true}); }
  catch(error){console.error('Collector post update failed:',error);return json({ok:false,error:String(error?.message||'').toLowerCase().includes('no such table')?'collector_social_migration_required':'collector_post_update_failed'},500);}
}
export async function onRequestDelete({ request, env }) {
  if (!env.DB) return json({ ok:false, error:'database_not_configured' }, 500);
  const account=await currentAccount(request,env).catch(()=>null); if(!account)return json({ok:false,error:'login_required'},401);
  const id=Number(new URL(request.url).searchParams.get('id')); if(!Number.isInteger(id)||id<1)return json({ok:false,error:'invalid_post_id'},400);
  try { const res=await env.DB.prepare('UPDATE collector_posts SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND account_id=? AND deleted_at IS NULL').bind(id,account.id).run(); if(!res.meta?.changes)return json({ok:false,error:'post_not_found'},404);return json({ok:true});}
  catch(error){console.error('Collector post delete failed:',error);return json({ok:false,error:String(error?.message||'').toLowerCase().includes('no such table')?'collector_social_migration_required':'collector_post_delete_failed'},500);}
}
export async function onRequest() { return json({ ok:false, error:'method_not_allowed' },405); }
