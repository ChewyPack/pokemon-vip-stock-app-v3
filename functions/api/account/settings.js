const COOKIE='collector_session';
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function cookie(request,name){for(const part of (request.headers.get('Cookie')||'').split(';')){const p=part.trim();if(p.startsWith(name+'='))return p.slice(name.length+1);}return '';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sha256(value){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
async function currentAccount(request,env){const token=cookie(request,COOKIE);if(!token)return null;const account=await env.DB.prepare('SELECT id,session_expires_at FROM accounts WHERE session_token_hash=? LIMIT 1').bind(await sha256(token)).first();return account&&Number(account.session_expires_at)>Date.now()?account:null;}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 const account=await currentAccount(request,env);if(!account)return json({ok:false,error:'login_required'},401);
 let data;try{data=await request.json();}catch{return json({ok:false,error:'bad_request'},400);}
 const displayName=typeof data.display_name==='string'?data.display_name.trim():'';
 const email=typeof data.email==='string'?data.email.trim().toLowerCase():'';
 const username=typeof data.username==='string'?data.username.trim():'';
 const phone=typeof data.phone_number==='string'?data.phone_number.trim():'';
 if(displayName.length<2||displayName.length>60)return json({ok:false,error:'invalid_name'},400);
 if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({ok:false,error:'invalid_email'},400);
 if(!/^[a-zA-Z0-9_]{3,24}$/.test(username))return json({ok:false,error:'invalid_username'},400);
 if(phone.length>30|| (phone&&!/^[+()\d .-]{7,30}$/.test(phone)))return json({ok:false,error:'invalid_phone'},400);
 try{
  const exists=await env.DB.prepare('SELECT id FROM accounts WHERE email=? COLLATE NOCASE AND id<>? LIMIT 1').bind(email,account.id).first();
  if(exists)return json({ok:false,error:'email_already_registered'},409);
  const usernameOwner=await env.DB.prepare('SELECT account_id FROM collector_profiles WHERE username=? COLLATE NOCASE LIMIT 1').bind(username).first();
  if(usernameOwner&&Number(usernameOwner.account_id)!==Number(account.id))return json({ok:false,error:'username_taken'},409);
  const profile=await env.DB.prepare('SELECT account_id FROM collector_profiles WHERE account_id=? LIMIT 1').bind(account.id).first();
  if(!profile)return json({ok:false,error:'collector_profile_missing'},409);
  await env.DB.batch([
   env.DB.prepare('UPDATE accounts SET display_name=?,email=?,phone_number=?,sms_alerts_enabled=CASE WHEN phone_number<>? THEN 0 ELSE sms_alerts_enabled END,sms_alert_consent_at=CASE WHEN phone_number<>? THEN NULL ELSE sms_alert_consent_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(displayName,email,phone,phone,phone,account.id),
   env.DB.prepare('UPDATE collector_profiles SET username=?,updated_at=CURRENT_TIMESTAMP WHERE account_id=?').bind(username,account.id)
  ]);
  return json({ok:true,account:{display_name:displayName,email,phone_number:phone,username}});
 }catch(error){
  console.error('Account settings save failed:',error);
  const msg=String(error&&error.message||'').toLowerCase();
  if(msg.includes('unique'))return json({ok:false,error:'email_or_username_taken'},409);
  if(msg.includes('no such column: phone_number'))return json({ok:false,error:'account_settings_migration_required'},500);
  return json({ok:false,error:'account_settings_save_failed'},500);
 }
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
