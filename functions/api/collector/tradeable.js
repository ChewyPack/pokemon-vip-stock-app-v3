const COOKIE='collector_session';
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function cookie(request,name){for(const part of (request.headers.get('Cookie')||'').split(';')){const p=part.trim();if(p.startsWith(name+'='))return p.slice(name.length+1);}return '';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sha256(value){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
async function currentAccount(request,env){const token=cookie(request,COOKIE);if(!token)return null;const a=await env.DB.prepare('SELECT id,session_expires_at FROM accounts WHERE session_token_hash=? LIMIT 1').bind(await sha256(token)).first();return a&&a.session_expires_at&&Number(a.session_expires_at)>Date.now()?a:null;}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 const account=await currentAccount(request,env);if(!account)return json({ok:false,error:'login_required'},401);
 let data;try{data=await request.json();}catch{return json({ok:false,error:'bad_request'},400);}
 const id=Number(data.id),tradeable=data.is_tradeable===true;
 if(!Number.isInteger(id)||id<1)return json({ok:false,error:'invalid_item_id'},400);
 try{
  const result=await env.DB.prepare("UPDATE collector_items SET is_tradeable=? WHERE id=? AND account_id=? AND list_type='collection'").bind(tradeable?1:0,id,account.id).run();
  if(!result.meta?.changes)return json({ok:false,error:'item_not_found'},404);
  return json({ok:true,id,is_tradeable:tradeable});
 }catch(error){console.error('Tradeable setting failed:',error);return json({ok:false,error:'wishlist_trades_migration_required'},500);}
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
