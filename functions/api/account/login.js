const SESSION_DAYS = 14;
const PBKDF2_ITERATIONS = 310000;
const COOKIE = 'collector_session';
function json(body, status = 200, headers = {}) { return new Response(JSON.stringify(body), { status, headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', ...headers } }); }
function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  return b64(await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:PBKDF2_ITERATIONS,hash:'SHA-256'},key,256));
}
async function sha256(value) { return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))); }
function cookie(token, expiresAt) { return [`${COOKIE}=${token}`,'Path=/','HttpOnly','Secure','SameSite=Lax',`Expires=${new Date(expiresAt).toUTCString()}`].join('; '); }
function equal(a,b) { if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0; }
export async function onRequestPost({request,env}) {
  if (!env.DB) return json({ok:false,error:'database_not_configured'},500);
  let data;try{data=await request.json();}catch{return json({ok:false,error:'bad_request'},400);}
  const email=typeof data.email==='string'?data.email.trim().toLowerCase():'';
  const password=typeof data.password==='string'?data.password:'';
  if(!email||!password||email.length>254||password.length>128)return json({ok:false,error:'invalid_credentials'},400);
  try {
    const account=await env.DB.prepare('SELECT id,display_name,email,account_type,password_salt,password_hash FROM accounts WHERE email=? COLLATE NOCASE LIMIT 1').bind(email).first();
    if(!account)return json({ok:false,error:'invalid_credentials'},401);
    let saltText=account.password_salt.replace(/-/g,'+').replace(/_/g,'/');
    saltText += '='.repeat((4-saltText.length%4)%4);
    const salt=Uint8Array.from(atob(saltText),c=>c.charCodeAt(0));
    if(!equal(await passwordHash(password,salt),account.password_hash))return json({ok:false,error:'invalid_credentials'},401);
    const token=b64(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash=await sha256(token);
    const expiresAt=Date.now()+SESSION_DAYS*86400000;
    await env.DB.prepare('UPDATE accounts SET session_token_hash=?,session_expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(tokenHash,expiresAt,account.id).run();
    return json({ok:true,account:{display_name:account.display_name,email:account.email,account_type:account.account_type}},200,{'Set-Cookie':cookie(token,expiresAt)});
  }catch(error){console.error('Account login failed:',error);return json({ok:false,error:'login_failed'},500);}
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
