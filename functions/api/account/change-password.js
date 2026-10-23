const COOKIE='collector_session';
const PBKDF2_ITERATIONS=100000;
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function cookie(request,name){for(const part of (request.headers.get('Cookie')||'').split(';')){const p=part.trim();if(p.startsWith(name+'='))return p.slice(name.length+1);}return '';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sha256(value){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
async function passwordHash(password,salt){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);return b64(await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:PBKDF2_ITERATIONS,hash:'SHA-256'},key,256));}
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 const token=cookie(request,COOKIE);if(!token)return json({ok:false,error:'login_required'},401);
 let data;try{data=await request.json();}catch{return json({ok:false,error:'bad_request'},400);}
 const currentPassword=typeof data.current_password==='string'?data.current_password:'';
 const newPassword=typeof data.new_password==='string'?data.new_password:'';
 if(!currentPassword||newPassword.length<10||newPassword.length>128)return json({ok:false,error:'password_requirements'},400);
 try{
  const account=await env.DB.prepare('SELECT id,password_salt,password_hash,session_expires_at FROM accounts WHERE session_token_hash=? LIMIT 1').bind(await sha256(token)).first();
  if(!account||Number(account.session_expires_at)<=Date.now())return json({ok:false,error:'login_required'},401);
  let saltText=account.password_salt.replace(/-/g,'+').replace(/_/g,'/');saltText+='='.repeat((4-saltText.length%4)%4);
  const oldSalt=Uint8Array.from(atob(saltText),c=>c.charCodeAt(0));
  if(!equal(await passwordHash(currentPassword,oldSalt),account.password_hash))return json({ok:false,error:'current_password_incorrect'},403);
  if(equal(currentPassword,newPassword))return json({ok:false,error:'new_password_must_differ'},400);
  const salt=crypto.getRandomValues(new Uint8Array(16)),hash=await passwordHash(newPassword,salt);
  await env.DB.prepare('UPDATE accounts SET password_salt=?,password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(b64(salt),hash,account.id).run();
  return json({ok:true});
 }catch(error){console.error('Password change failed:',error);return json({ok:false,error:'password_change_failed'},500);}
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
