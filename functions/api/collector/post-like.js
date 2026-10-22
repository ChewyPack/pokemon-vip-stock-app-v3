import { notifyCollector } from '../../_lib/collector-notifications.js';
const COOKIE='collector_session';
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function cookie(request,name){for(const part of (request.headers.get('Cookie')||'').split(';')){const p=part.trim();if(p.startsWith(name+'='))return p.slice(name.length+1);}return '';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sha256(value){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
async function auth(request,env){const token=cookie(request,COOKIE);if(!token)return null;const a=await env.DB.prepare('SELECT id,session_expires_at FROM accounts WHERE session_token_hash=? LIMIT 1').bind(await sha256(token)).first();return a&&a.session_expires_at&&Number(a.session_expires_at)>Date.now()?a:null;}
async function target(request,env,id,viewerId){return env.DB.prepare(`SELECT p.id,p.account_id,cp.username AS author_username,p.body FROM collector_posts p JOIN collector_profiles cp ON cp.account_id=p.account_id WHERE p.id=? AND p.deleted_at IS NULL AND cp.is_public=1 AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM collector_blocks b WHERE (b.blocker_account_id=? AND b.blocked_account_id=p.account_id) OR (b.blocker_account_id=p.account_id AND b.blocked_account_id=?))) LIMIT 1`).bind(id,viewerId,viewerId,viewerId).first();}
export async function onRequestGet({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 const id=Number(new URL(request.url).searchParams.get('id'));
 if(!Number.isSafeInteger(id)||id<1)return json({ok:false,error:'invalid_post_id'},400);
 try{
  const viewer=await auth(request,env).catch(()=>null);
  if(!await target(request,env,id,viewer?.id??null))return json({ok:false,error:'post_not_found'},404);
  const result=await env.DB.prepare(`SELECT l.created_at,p.username,p.avatar_url,a.display_name
   FROM collector_post_likes l JOIN collector_profiles p ON p.account_id=l.account_id
   JOIN accounts a ON a.id=l.account_id
   WHERE l.post_id=? AND p.is_public=1
   AND NOT EXISTS (SELECT 1 FROM collector_blocks b
    WHERE (b.blocker_account_id=? AND b.blocked_account_id=l.account_id)
       OR (b.blocker_account_id=l.account_id AND b.blocked_account_id=?))
   ORDER BY l.created_at DESC,p.username COLLATE NOCASE LIMIT 100`).bind(id,viewer?.id??-1,viewer?.id??-1).all();
  return json({ok:true,users:(result.results||[]).map(row=>({username:row.username,display_name:row.display_name||row.username,avatar_url:row.avatar_url||'',liked_at:row.created_at}))});
 }catch(error){console.error('Post likers read failed:',error);return json({ok:false,error:String(error?.message||'').toLowerCase().includes('no such table')?'collector_social_migration_required':'post_likers_read_failed'},500);}
}
export async function onRequestPost({request,env}){if(!env.DB)return json({ok:false,error:'database_not_configured'},500);const a=await auth(request,env);if(!a)return json({ok:false,error:'login_required'},401);const id=Number(new URL(request.url).searchParams.get('id'));if(!Number.isInteger(id)||id<1)return json({ok:false,error:'invalid_post_id'},400);try{if(!await target(request,env,id,a.id))return json({ok:false,error:'post_not_found'},404);const inserted=await env.DB.prepare('INSERT OR IGNORE INTO collector_post_likes(post_id,account_id) VALUES(?,?)').bind(id,a.id).run();const n=await env.DB.prepare('SELECT COUNT(*) AS count FROM collector_post_likes WHERE post_id=?').bind(id).first();if(Number(inserted.meta?.changes||0)>0&&Number((await target(request,env,id,a.id))?.account_id)!==Number(a.id)){const post=await target(request,env,id,a.id);const actor=await env.DB.prepare('SELECT p.username,a.display_name FROM collector_profiles p JOIN accounts a ON a.id=p.account_id WHERE p.account_id=? LIMIT 1').bind(a.id).first();if(post&&actor?.username)await notifyCollector(env,post.account_id,{type:'post_like',title:'New like on your post',body:(actor.display_name||actor.username)+' liked your post.',url:'/newsfeed?post='+id,data:{kind:'post_like',post_id:id,from:actor.username}});}return json({ok:true,liked:true,like_count:Number(n?.count||0)});}catch(e){console.error('Post like failed:',e);return json({ok:false,error:String(e?.message||'').toLowerCase().includes('no such table')?'collector_social_migration_required':'post_like_failed'},500);}}
export async function onRequestDelete({request,env}){if(!env.DB)return json({ok:false,error:'database_not_configured'},500);const a=await auth(request,env);if(!a)return json({ok:false,error:'login_required'},401);const id=Number(new URL(request.url).searchParams.get('id'));if(!Number.isInteger(id)||id<1)return json({ok:false,error:'invalid_post_id'},400);try{if(!await target(request,env,id,a.id))return json({ok:false,error:'post_not_found'},404);await env.DB.prepare('DELETE FROM collector_post_likes WHERE post_id=? AND account_id=?').bind(id,a.id).run();const n=await env.DB.prepare('SELECT COUNT(*) AS count FROM collector_post_likes WHERE post_id=?').bind(id).first();return json({ok:true,liked:false,like_count:Number(n?.count||0)});}catch(e){console.error('Post unlike failed:',e);return json({ok:false,error:String(e?.message||'').toLowerCase().includes('no such table')?'collector_social_migration_required':'post_like_failed'},500);}}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
