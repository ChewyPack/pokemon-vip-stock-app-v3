import { notifyCollector } from '../../_lib/collector-notifications.js';
const COOKIE='collector_session';
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function cookie(request,name){for(const part of (request.headers.get('Cookie')||'').split(';')){const p=part.trim();if(p.startsWith(name+'='))return p.slice(name.length+1);}return '';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sha256(value){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
async function auth(request,env){const token=cookie(request,COOKIE);if(!token)return null;const a=await env.DB.prepare('SELECT id,session_expires_at FROM accounts WHERE session_token_hash=? LIMIT 1').bind(await sha256(token)).first();return a&&a.session_expires_at&&Number(a.session_expires_at)>Date.now()?a:null;}
async function hasReplyColumn(db){
  const info=await db.prepare('PRAGMA table_info(collector_post_comments)').all();
  return (info.results||[]).some(column=>column.name==='parent_comment_id');
}
async function visiblePost(env,id,viewerId){return env.DB.prepare(`SELECT p.id,p.account_id,cp.username AS author_username FROM collector_posts p JOIN collector_profiles cp ON cp.account_id=p.account_id WHERE p.id=? AND p.deleted_at IS NULL AND cp.is_public=1 AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM collector_blocks b WHERE (b.blocker_account_id=? AND b.blocked_account_id=p.account_id) OR (b.blocker_account_id=p.account_id AND b.blocked_account_id=?))) LIMIT 1`).bind(id,viewerId,viewerId,viewerId).first();}
export async function onRequestGet({request,env}){
  if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
  const postId=Number(new URL(request.url).searchParams.get('post_id'));
  if(!Number.isInteger(postId)||postId<1)return json({ok:false,error:'invalid_post_id'},400);
  try{
    const viewer=await auth(request,env).catch(()=>null);
    if(!await visiblePost(env,postId,viewer?.id??null))return json({ok:false,error:'post_not_found'},404);
    const supportsReplies=await hasReplyColumn(env.DB);
    const parentSelect=supportsReplies?'c.parent_comment_id':'NULL AS parent_comment_id';
    const r=await env.DB.prepare(`SELECT c.id,c.body,c.created_at,c.updated_at,c.account_id,${parentSelect},p.username,p.avatar_url,a.display_name
      FROM collector_post_comments c
      JOIN collector_posts sp ON sp.id=c.post_id
      JOIN collector_profiles p ON p.account_id=c.account_id
      JOIN accounts a ON a.id=c.account_id
      WHERE c.post_id=? AND c.deleted_at IS NULL AND p.is_public=1
        AND NOT EXISTS (SELECT 1 FROM collector_blocks b WHERE (b.blocker_account_id=? AND b.blocked_account_id=c.account_id) OR (b.blocker_account_id=c.account_id AND b.blocked_account_id=?))
      ORDER BY c.created_at ASC,c.id ASC LIMIT 100`).bind(postId,viewer?.id??-1,viewer?.id??-1).all();
    return json({ok:true,supports_replies:supportsReplies,comments:(r.results||[]).map(c=>({id:Number(c.id),parent_comment_id:c.parent_comment_id==null?null:Number(c.parent_comment_id),body:c.body,created_at:c.created_at,username:c.username,display_name:c.display_name||c.username,avatar_url:c.avatar_url||'',is_own:!!viewer&&Number(c.account_id)===Number(viewer.id)}))});
  }catch(e){console.error('Post comments read failed:',e);return json({ok:false,error:String(e?.message||'').toLowerCase().includes('no such table')?'collector_social_migration_required':'post_comments_read_failed'},500);}
}
export async function onRequestPost({request,env}){
  if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
  const a=await auth(request,env);
  if(!a)return json({ok:false,error:'login_required'},401);
  let data;try{data=await request.json();}catch{return json({ok:false,error:'invalid_json'},400);}
  const postId=Number(data.post_id),body=typeof data.body==='string'?data.body.trim():'';
  const hasParent=Object.prototype.hasOwnProperty.call(data,'parent_comment_id')&&data.parent_comment_id!==null&&data.parent_comment_id!=='';
  const parentId=hasParent?Number(data.parent_comment_id):null;
  if(!Number.isInteger(postId)||postId<1)return json({ok:false,error:'invalid_post_id'},400);
  if(hasParent&&(!Number.isSafeInteger(parentId)||parentId<1))return json({ok:false,error:'invalid_parent_comment_id'},400);
  if(!body||body.length>1000)return json({ok:false,error:'invalid_comment'},400);
  try{
    const post=await visiblePost(env,postId,a.id);
    if(!post)return json({ok:false,error:'post_not_found'},404);
    const supportsReplies=await hasReplyColumn(env.DB);
    if(hasParent&&!supportsReplies)return json({ok:false,error:'comment_replies_migration_required'},503);
    let parent=null;
    if(hasParent){
      parent=await env.DB.prepare(`SELECT c.id,c.account_id,p.username
        FROM collector_post_comments c JOIN collector_profiles p ON p.account_id=c.account_id
        WHERE c.id=? AND c.post_id=? AND c.deleted_at IS NULL AND p.is_public=1
          AND NOT EXISTS (SELECT 1 FROM collector_blocks b WHERE (b.blocker_account_id=? AND b.blocked_account_id=c.account_id) OR (b.blocker_account_id=c.account_id AND b.blocked_account_id=?))
        LIMIT 1`).bind(parentId,postId,a.id,a.id).first();
      if(!parent)return json({ok:false,error:'parent_comment_not_found'},404);
    }
    const r=supportsReplies
      ? await env.DB.prepare('INSERT INTO collector_post_comments(post_id,account_id,body,parent_comment_id) VALUES(?,?,?,?)').bind(postId,a.id,body,parentId).run()
      : await env.DB.prepare('INSERT INTO collector_post_comments(post_id,account_id,body) VALUES(?,?,?)').bind(postId,a.id,body).run();
    const commentId=Number(r.meta?.last_row_id||0);
    try { await env.DB.prepare(`CREATE TABLE IF NOT EXISTS collector_hashtags(tag TEXT PRIMARY KEY,display_tag TEXT NOT NULL,usage_count INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run(); const tags=[...new Set((body.match(/(^|\s)#[a-zA-Z0-9_]{2,30}/g)||[]).map(x=>x.trim().slice(1)))]; for (const display of tags) await env.DB.prepare(\`INSERT INTO collector_hashtags(tag,display_tag,usage_count) VALUES(?,?,1) ON CONFLICT(tag) DO UPDATE SET usage_count=collector_hashtags.usage_count+1,display_tag=excluded.display_tag,updated_at=CURRENT_TIMESTAMP\`).bind(display.toLowerCase(),display).run(); } catch (tagError) { console.error('Hashtag tracking skipped:',tagError); }
    const actor=await env.DB.prepare('SELECT p.username,a.display_name FROM collector_profiles p JOIN accounts a ON a.id=p.account_id WHERE p.account_id=? LIMIT 1').bind(a.id).first();
    if(actor?.username){
      const excerpt=body.length>160?body.slice(0,157)+'…':body;
      const actorName=actor.display_name||actor.username;
      if(parent&&Number(parent.account_id)!==Number(a.id)){
        await notifyCollector(env,parent.account_id,{type:'post_comment_reply',title:'New reply to your comment',body:actorName+' replied to your comment: '+excerpt,url:'/newsfeed?post='+postId,data:{kind:'post_comment_reply',post_id:postId,comment_id:commentId,parent_comment_id:parentId,from:actor.username}});
      }else if(!parent&&Number(post.account_id)!==Number(a.id)){
        await notifyCollector(env,post.account_id,{type:'post_comment',title:'New comment on your post',body:actorName+': '+excerpt,url:'/newsfeed?post='+postId,data:{kind:'post_comment',post_id:postId,comment_id:commentId,from:actor.username}});
      }
    }
    return json({ok:true,id:commentId,parent_comment_id:parentId},201);
  }catch(e){console.error('Post comment create failed:',e);return json({ok:false,error:String(e?.message||'').toLowerCase().includes('no such table')?'collector_social_migration_required':'post_comment_create_failed'},500);}
}
export async function onRequestDelete({request,env}){
  if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
  const a=await auth(request,env);if(!a)return json({ok:false,error:'login_required'},401);
  const id=Number(new URL(request.url).searchParams.get('id'));if(!Number.isInteger(id)||id<1)return json({ok:false,error:'invalid_comment_id'},400);
  try{const r=await env.DB.prepare('UPDATE collector_post_comments SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND account_id=? AND deleted_at IS NULL').bind(id,a.id).run();if(!r.meta?.changes)return json({ok:false,error:'comment_not_found'},404);return json({ok:true});}
  catch(e){console.error('Post comment delete failed:',e);return json({ok:false,error:String(e?.message||'').toLowerCase().includes('no such table')?'collector_social_migration_required':'post_comment_delete_failed'},500);}
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
