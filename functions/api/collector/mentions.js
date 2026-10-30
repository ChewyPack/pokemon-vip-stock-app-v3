const COOKIE='collector_session';
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function cookie(request,name){for(const part of (request.headers.get('Cookie')||'').split(';')){const value=part.trim();if(value.startsWith(name+'='))return value.slice(name.length+1);}return '';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');}
async function sha256(value){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
async function currentAccount(request,env){
 const token=cookie(request,COOKIE);if(!token)return null;
 const account=await env.DB.prepare('SELECT id,session_expires_at FROM accounts WHERE session_token_hash=? LIMIT 1').bind(await sha256(token)).first();
 return account&&account.session_expires_at&&Number(account.session_expires_at)>Date.now()?account:null;
}
export async function onRequestGet({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 const viewer=await currentAccount(request,env).catch(()=>null);
 if(!viewer)return json({ok:false,error:'login_required'},401);
 const url=new URL(request.url),query=String(url.searchParams.get('q')||'').trim().replace(/^@/,'').slice(0,24);
 if(!/^[a-zA-Z0-9_]{0,24}$/.test(query))return json({ok:true,members:[]});
 
 try{
  const pattern=query ? query.toLowerCase()+'%' : '%';
  const result=await env.DB.prepare(`
   SELECT cp.username,cp.avatar_url,a.display_name
   FROM collector_profiles cp JOIN accounts a ON a.id=cp.account_id
   WHERE cp.is_public=1 AND cp.account_id<>?
     AND lower(cp.username) LIKE ?
     AND NOT EXISTS(SELECT 1 FROM collector_blocks b WHERE (b.blocker_account_id=? AND b.blocked_account_id=cp.account_id) OR (b.blocker_account_id=cp.account_id AND b.blocked_account_id=?))
   ORDER BY CASE WHEN lower(cp.username)=? THEN 0 ELSE 1 END, lower(cp.username)
   LIMIT 7
  `).bind(viewer.id,pattern,viewer.id,viewer.id,query.toLowerCase()).all();
  return json({ok:true,members:(result.results||[]).map(row=>({username:row.username,display_name:row.display_name||row.username,avatar_url:row.avatar_url||''}))});
 }catch(error){
  console.error('Collector mention lookup failed:',error);
  return json({ok:false,error:'mention_search_failed'},500);
 }
}
