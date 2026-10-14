const COOKIE='collector_session';
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function getCookie(request,name){for(const part of (request.headers.get('Cookie')||'').split(';')){const p=part.trim();if(p.startsWith(name+'='))return p.slice(name.length+1);}return '';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sha256(value){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
export async function onRequestGet({request,env}){
 const token=getCookie(request,COOKIE); if(!token)return json({ok:true,authenticated:false});
 try{
  const hash=await sha256(token);
  const account=await env.DB.prepare('SELECT id,display_name,email,created_at,session_expires_at FROM accounts WHERE session_token_hash=? LIMIT 1').bind(hash).first();
  if(!account||!account.session_expires_at||Number(account.session_expires_at)<=Date.now())return json({ok:true,authenticated:false});
  const vip=await env.DB.prepare("SELECT membership_status,membership_type FROM users WHERE LOWER(TRIM(email))=LOWER(TRIM(?)) LIMIT 1").bind(account.email).first().catch(()=>null);
  return json({ok:true,authenticated:true,account:{display_name:account.display_name,email:account.email,created_at:account.created_at},membership:{status:'unverified',message:'VIP membership is separate. We will not link a VIP record based on email alone.'}});
 }catch(error){console.error('Account session check failed:',error);return json({ok:false,error:'account_check_failed'},500);}
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
