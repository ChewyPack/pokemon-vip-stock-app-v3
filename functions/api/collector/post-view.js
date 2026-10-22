import { ensureCollectorPostViews } from '../../_lib/collector-post-views.js';

const COOKIE='collector_session';
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function cookie(request,name){for(const part of (request.headers.get('Cookie')||'').split(';')){const p=part.trim();if(p.startsWith(name+'='))return p.slice(name.length+1);}return '';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sha256(value){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
async function auth(request,env){const token=cookie(request,COOKIE);if(!token)return null;const a=await env.DB.prepare('SELECT id,session_expires_at FROM accounts WHERE session_token_hash=? LIMIT 1').bind(await sha256(token)).first();return a&&a.session_expires_at&&Number(a.session_expires_at)>Date.now()?a:null;}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 let data;try{data=await request.json();}catch{return json({ok:false,error:'invalid_json'},400);}
 const postId=Number(data.post_id),browserKey=typeof data.viewer_key==='string'?data.viewer_key:'';
 if(!Number.isSafeInteger(postId)||postId<1)return json({ok:false,error:'invalid_post_id'},400);
 if(!/^[a-f0-9-]{36}$/i.test(browserKey))return json({ok:false,error:'invalid_viewer_key'},400);
 try{
  const viewer=await auth(request,env).catch(()=>null);
  await ensureCollectorPostViews(env.DB);
  const post=await env.DB.prepare(`SELECT p.id,p.account_id FROM collector_posts p
   JOIN collector_profiles cp ON cp.account_id=p.account_id
   WHERE p.id=? AND p.deleted_at IS NULL AND cp.is_public=1
   AND (? IS NULL OR NOT EXISTS (
    SELECT 1 FROM collector_blocks b
    WHERE (b.blocker_account_id=? AND b.blocked_account_id=p.account_id)
       OR (b.blocker_account_id=p.account_id AND b.blocked_account_id=?)
   )) LIMIT 1`).bind(postId,viewer?.id??null,viewer?.id??null,viewer?.id??null).first();
  if(!post)return json({ok:false,error:'post_not_found'},404);
  let counted=false;
  if(!viewer||Number(viewer.id)!==Number(post.account_id)){
   const identity=viewer?'account:'+Number(viewer.id):'browser:'+browserKey.toLowerCase();
   const keyHash=await sha256(identity);
   const inserted=await env.DB.prepare('INSERT OR IGNORE INTO collector_post_views(post_id,viewer_key_hash,viewer_account_id) VALUES(?,?,?)')
    .bind(postId,keyHash,viewer?viewer.id:null).run();
   counted=Number(inserted.meta?.changes||0)>0;
  }
  const count=await env.DB.prepare('SELECT COUNT(*) AS count FROM collector_post_views WHERE post_id=?').bind(postId).first();
  return json({ok:true,counted,view_count:viewer&&Number(viewer.id)===Number(post.account_id)?Number(count?.count||0):null});
 }catch(error){
  console.error('Post view tracking failed:',error);
  return json({ok:false,error:'post_view_tracking_failed'},500);
 }
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
