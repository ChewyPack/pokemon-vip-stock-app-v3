import { notifyCollector } from '../../_lib/collector-notifications.js';
const COOKIE='collector_session';
const REACTIONS=new Set(['like','love','haha','wow','sad','angry']);
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function cookie(request,name){for(const part of (request.headers.get('Cookie')||'').split(';')){const p=part.trim();if(p.startsWith(name+'='))return p.slice(name.length+1);}return '';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sha256(value){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
async function auth(request,env){const token=cookie(request,COOKIE);if(!token)return null;const a=await env.DB.prepare('SELECT id,session_expires_at FROM accounts WHERE session_token_hash=? LIMIT 1').bind(await sha256(token)).first();return a&&a.session_expires_at&&Number(a.session_expires_at)>Date.now()?a:null;}
async function target(env,id,viewerId){return env.DB.prepare(`SELECT p.id,p.account_id,cp.username AS author_username FROM collector_posts p JOIN collector_profiles cp ON cp.account_id=p.account_id WHERE p.id=? AND p.deleted_at IS NULL AND cp.is_public=1 AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM collector_blocks b WHERE (b.blocker_account_id=? AND b.blocked_account_id=p.account_id) OR (b.blocker_account_id=p.account_id AND b.blocked_account_id=?))) LIMIT 1`).bind(id,viewerId,viewerId,viewerId).first();}
function migrationError(error){return String(error?.message||'').toLowerCase().includes('no such table');}
export async function onRequestGet({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 const id=Number(new URL(request.url).searchParams.get('id'));
 if(!Number.isSafeInteger(id)||id<1)return json({ok:false,error:'invalid_post_id'},400);
 try{
  const viewer=await auth(request,env).catch(()=>null);
  if(!await target(env,id,viewer?.id??null))return json({ok:false,error:'post_not_found'},404);
  const [counts,users]=await Promise.all([
   env.DB.prepare('SELECT reaction,COUNT(*) AS count FROM collector_post_reactions WHERE post_id=? GROUP BY reaction').bind(id).all(),
   env.DB.prepare(`SELECT r.reaction,r.created_at,p.username,p.avatar_url,a.display_name
    FROM collector_post_reactions r JOIN collector_profiles p ON p.account_id=r.account_id
    JOIN accounts a ON a.id=r.account_id WHERE r.post_id=? AND p.is_public=1
    AND NOT EXISTS (SELECT 1 FROM collector_blocks b WHERE (b.blocker_account_id=? AND b.blocked_account_id=r.account_id) OR (b.blocker_account_id=r.account_id AND b.blocked_account_id=?))
    ORDER BY r.created_at DESC,p.username COLLATE NOCASE LIMIT 100`).bind(id,viewer?.id??-1,viewer?.id??-1).all()
  ]);
  const summary={};for(const row of counts.results||[])summary[row.reaction]=Number(row.count||0);
  return json({ok:true,counts:summary,users:(users.results||[]).map(row=>({reaction:row.reaction,username:row.username,display_name:row.display_name||row.username,avatar_url:row.avatar_url||'',reacted_at:row.created_at}))});
 }catch(error){console.error('Post reactions read failed:',error);return json({ok:false,error:migrationError(error)?'collector_social_migration_required':'post_reactions_read_failed'},500);}
}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 const account=await auth(request,env);if(!account)return json({ok:false,error:'login_required'},401);
 const id=Number(new URL(request.url).searchParams.get('id'));
 if(!Number.isSafeInteger(id)||id<1)return json({ok:false,error:'invalid_post_id'},400);
 let data;try{data=await request.json();}catch(_){return json({ok:false,error:'invalid_json'},400);}
 const reaction=String(data.reaction||'').toLowerCase();if(!REACTIONS.has(reaction))return json({ok:false,error:'invalid_reaction'},400);
 try{
  const post=await target(env,id,account.id);if(!post)return json({ok:false,error:'post_not_found'},404);
  const existing=await env.DB.prepare('SELECT reaction FROM collector_post_reactions WHERE post_id=? AND account_id=?').bind(id,account.id).first();
  let myReaction=reaction;
  if(existing?.reaction===reaction){await env.DB.prepare('DELETE FROM collector_post_reactions WHERE post_id=? AND account_id=?').bind(id,account.id).run();myReaction='';}
  else{
   await env.DB.prepare(`INSERT INTO collector_post_reactions(post_id,account_id,reaction) VALUES(?,?,?)
    ON CONFLICT(post_id,account_id) DO UPDATE SET reaction=excluded.reaction,updated_at=CURRENT_TIMESTAMP`).bind(id,account.id,reaction).run();
   if(!existing&&Number(post.account_id)!==Number(account.id)){
    const actor=await env.DB.prepare('SELECT p.username,a.display_name FROM collector_profiles p JOIN accounts a ON a.id=p.account_id WHERE p.account_id=? LIMIT 1').bind(account.id).first();
    const labels={like:'liked',love:'loved',haha:'reacted 😂 to',wow:'reacted 😮 to',sad:'reacted 😢 to',angry:'reacted 😡 to'};
    if(actor?.username)await notifyCollector(env,post.account_id,{type:'post_reaction',title:'New reaction on your post',body:(actor.display_name||actor.username)+' '+labels[reaction]+' your post.',url:'/newsfeed?post='+id,data:{kind:'post_reaction',post_id:id,from:actor.username,reaction}});
   }
  }
  const [count,counts]=await Promise.all([
   env.DB.prepare('SELECT COUNT(*) AS count FROM collector_post_reactions WHERE post_id=?').bind(id).first(),
   env.DB.prepare('SELECT reaction,COUNT(*) AS count FROM collector_post_reactions WHERE post_id=? GROUP BY reaction').bind(id).all()
  ]);
  const summary={};for(const row of counts.results||[])summary[row.reaction]=Number(row.count||0);
  return json({ok:true,my_reaction:myReaction,reaction_count:Number(count?.count||0),counts:summary});
 }catch(error){console.error('Post reaction save failed:',error);return json({ok:false,error:migrationError(error)?'collector_social_migration_required':'post_reaction_failed'},500);}
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
