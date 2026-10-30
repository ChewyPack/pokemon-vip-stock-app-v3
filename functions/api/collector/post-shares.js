const COOKIE='collector_session';
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function cookie(request,name){for(const part of (request.headers.get('Cookie')||'').split(';')){const value=part.trim();if(value.startsWith(name+'='))return value.slice(name.length+1);}return '';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');}
async function sha256(value){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
async function auth(request,env){const token=cookie(request,COOKIE);if(!token)return null;const account=await env.DB.prepare('SELECT id,session_expires_at FROM accounts WHERE session_token_hash=? LIMIT 1').bind(await sha256(token)).first();return account&&account.session_expires_at&&Number(account.session_expires_at)>Date.now()?account:null;}
function migrationError(error){return String(error?.message||'').toLowerCase().includes('no such table');}
async function visiblePost(env,postId,viewerId){
 return env.DB.prepare(`SELECT p.id,p.account_id FROM collector_posts p JOIN collector_profiles cp ON cp.account_id=p.account_id
 WHERE p.id=? AND p.deleted_at IS NULL AND cp.is_public=1
 AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM collector_blocks b WHERE (b.blocker_account_id=? AND b.blocked_account_id=p.account_id) OR (b.blocker_account_id=p.account_id AND b.blocked_account_id=?))) LIMIT 1`).bind(postId,viewerId,viewerId,viewerId).first();
}
export async function onRequestGet({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 const viewer=await auth(request,env).catch(()=>null), postId=Number(new URL(request.url).searchParams.get('post_id'));
 if(!Number.isSafeInteger(postId)||postId<1)return json({ok:false,error:'invalid_post_id'},400);
 try{
  const post=await visiblePost(env,postId,viewer?.id??null);if(!post)return json({ok:false,error:'post_not_found'},404);
  const [count,mine]=await Promise.all([
   env.DB.prepare("SELECT COUNT(*) AS count FROM collector_post_shares s JOIN collector_profiles cp ON cp.account_id=s.account_id WHERE s.post_id=? AND cp.is_public=1").bind(postId).first(),
   viewer?env.DB.prepare("SELECT id,share_type FROM collector_post_shares WHERE post_id=? AND account_id=? AND share_type='repost' LIMIT 1").bind(postId,viewer.id).first():Promise.resolve(null)
  ]);
  return json({ok:true,share_count:Number(count?.count||0),is_reposted_by_me:!!mine,my_repost_id:mine?Number(mine.id):null});
 }catch(error){console.error('Post share read failed:',error);return json({ok:false,error:migrationError(error)?'collector_shares_migration_required':'post_share_read_failed'},500);}
}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 const viewer=await auth(request,env).catch(()=>null);if(!viewer)return json({ok:false,error:'login_required'},401);
 let data;try{data=await request.json();}catch(_){return json({ok:false,error:'invalid_json'},400);}
 const postId=Number(data.post_id),type=data.share_type==='quote'?'quote':'repost',body=typeof data.body==='string'?data.body.trim():'';
 if(!Number.isSafeInteger(postId)||postId<1)return json({ok:false,error:'invalid_post_id'},400);
 if(type==='quote'&&(!body||body.length>2000))return json({ok:false,error:body?'post_too_long':'quote_text_required'},400);
 if(type==='repost'&&body)return json({ok:false,error:'invalid_share'},400);
 try{
  const post=await visiblePost(env,postId,viewer.id);if(!post)return json({ok:false,error:'post_not_found'},404);
  if(type==='repost'){
   await env.DB.prepare("INSERT OR IGNORE INTO collector_post_shares(account_id,post_id,share_type,body) VALUES(?,?,'repost','')").bind(viewer.id,postId).run();
   const saved=await env.DB.prepare("SELECT id FROM collector_post_shares WHERE account_id=? AND post_id=? AND share_type='repost' LIMIT 1").bind(viewer.id,postId).first();
   return json({ok:true,share_id:Number(saved.id),share_type:'repost',already_shared:true},200);
  }
  const result=await env.DB.prepare("INSERT INTO collector_post_shares(account_id,post_id,share_type,body) VALUES(?,?,'quote',?)").bind(viewer.id,postId,body).run();
  return json({ok:true,share_id:Number(result.meta?.last_row_id||0),share_type:'quote'},201);
 }catch(error){console.error('Post share create failed:',error);return json({ok:false,error:migrationError(error)?'collector_shares_migration_required':'post_share_create_failed'},500);}
}
export async function onRequestDelete({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 const viewer=await auth(request,env).catch(()=>null);if(!viewer)return json({ok:false,error:'login_required'},401);
 const id=Number(new URL(request.url).searchParams.get('id'));
 if(!Number.isSafeInteger(id)||id<1)return json({ok:false,error:'invalid_share_id'},400);
 try{
  const result=await env.DB.prepare('DELETE FROM collector_post_shares WHERE id=? AND account_id=?').bind(id,viewer.id).run();
  if(!result.meta?.changes)return json({ok:false,error:'share_not_found'},404);
  return json({ok:true});
 }catch(error){console.error('Post share delete failed:',error);return json({ok:false,error:migrationError(error)?'collector_shares_migration_required':'post_share_delete_failed'},500);}
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
