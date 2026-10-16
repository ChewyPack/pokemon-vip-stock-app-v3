const COOKIE='collector_session';
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function cookie(request,name){for(const part of (request.headers.get('Cookie')||'').split(';')){const p=part.trim();if(p.startsWith(name+'='))return p.slice(name.length+1);}return '';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sha256(value){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
async function currentAccount(request,env){
 const token=cookie(request,COOKIE);if(!token)return null;
 const account=await env.DB.prepare('SELECT id,display_name,email,session_expires_at FROM accounts WHERE session_token_hash=? LIMIT 1').bind(await sha256(token)).first();
 if(!account||!account.session_expires_at||Number(account.session_expires_at)<=Date.now())return null;
 return account;
}
function safeUsername(value){return typeof value==='string'&&/^[a-zA-Z0-9_]{3,24}$/.test(value);}
export async function onRequestGet({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 const url=new URL(request.url),requested=(url.searchParams.get('username')||'').trim();
 try{
  if(requested){
   const profile=await env.DB.prepare(`SELECT p.username,p.bio,p.avatar_url,p.is_public,p.created_at,a.display_name FROM collector_profiles p JOIN accounts a ON a.id=p.account_id WHERE p.username=? COLLATE NOCASE LIMIT 1`).bind(requested).first();
   if(!profile||Number(profile.is_public)!==1)return json({ok:false,error:'profile_not_found'},404);
   const stats=await env.DB.prepare(`SELECT COUNT(*) AS total_items,COALESCE(SUM(quantity),0) AS total_quantity,COALESCE(SUM(CASE WHEN list_type='collection' THEN COALESCE(estimated_value_cents,0)*quantity ELSE 0 END),0) AS estimated_value_cents,COALESCE(SUM(CASE WHEN list_type='collection' AND product_type='sealed' THEN quantity ELSE 0 END),0) AS sealed_quantity,COALESCE(SUM(CASE WHEN list_type='collection' AND product_type='graded' THEN quantity ELSE 0 END),0) AS graded_quantity FROM collector_items WHERE account_id=(SELECT account_id FROM collector_profiles WHERE username=? COLLATE NOCASE) AND list_type='collection'`).bind(requested).first();
   const items=await env.DB.prepare(`SELECT id,list_type,product_type,product_name,set_name,card_number,condition,quantity,notes,image_url,estimated_value_cents,created_at FROM collector_items WHERE account_id=(SELECT account_id FROM collector_profiles WHERE username=? COLLATE NOCASE) ORDER BY created_at DESC LIMIT 500`).bind(requested).all();
   return json({ok:true,profile:{username:profile.username,display_name:profile.display_name,bio:profile.bio,avatar_url:profile.avatar_url,created_at:profile.created_at},stats:stats||{},items:items.results||[]});
  }
  const account=await currentAccount(request,env);if(!account)return json({ok:false,error:'login_required'},401);
  const profile=await env.DB.prepare('SELECT username,bio,avatar_url,is_public,created_at FROM collector_profiles WHERE account_id=? LIMIT 1').bind(account.id).first();
  const items=await env.DB.prepare('SELECT id,list_type,product_type,product_name,set_name,card_number,condition,quantity,notes,image_url,estimated_value_cents,created_at FROM collector_items WHERE account_id=? ORDER BY created_at DESC LIMIT 500').bind(account.id).all();
  return json({ok:true,account:{display_name:account.display_name},profile:profile||null,items:items.results||[]});
 }catch(error){console.error('Collector profile read failed:',error);return json({ok:false,error:'collector_profile_read_failed'},500);}
}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 const account=await currentAccount(request,env);if(!account)return json({ok:false,error:'login_required'},401);
 let data;try{data=await request.json();}catch{return json({ok:false,error:'bad_request'},400);}
 const username=typeof data.username==='string'?data.username.trim():'';
 const bio=typeof data.bio==='string'?data.bio.trim():'';
 const avatar=typeof data.avatar_url==='string'?data.avatar_url.trim():'';
 const isPublic=data.is_public===false?0:1;
 if(!safeUsername(username))return json({ok:false,error:'invalid_username'},400);
 if(bio.length>500)return json({ok:false,error:'bio_too_long'},400);
 if(avatar.length>500|| (avatar&&!/^https:\/\//i.test(avatar)))return json({ok:false,error:'invalid_avatar_url'},400);
 try{
  const result=await env.DB.prepare(`INSERT INTO collector_profiles(account_id,username,bio,avatar_url,is_public) VALUES(?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET username=excluded.username,bio=excluded.bio,avatar_url=excluded.avatar_url,is_public=excluded.is_public,updated_at=CURRENT_TIMESTAMP`).bind(account.id,username,bio,avatar,isPublic).run();
  return json({ok:true,profile:{username,bio,avatar_url:avatar,is_public:isPublic}},200);
 }catch(error){
  if(String(error&&error.message||'').toLowerCase().includes('unique'))return json({ok:false,error:'username_taken'},409);
  console.error('Collector profile save failed:',error);return json({ok:false,error:'profile_save_failed'},500);
 }
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
