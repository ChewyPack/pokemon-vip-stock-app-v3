function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','Set-Cookie':'collector_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'}});}
function getCookie(request,name){for(const part of (request.headers.get('Cookie')||'').split(';')){const p=part.trim();if(p.startsWith(name+'='))return p.slice(name.length+1);}return '';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sha256(value){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
export async function onRequestPost({request,env}){
 const token=getCookie(request,'collector_session');
 if(token){try{await env.DB.prepare('UPDATE accounts SET session_token_hash=NULL,session_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE session_token_hash=?').bind(await sha256(token)).run();}catch(error){console.error('Logout session clear failed:',error);}}
 return json({ok:true});
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
