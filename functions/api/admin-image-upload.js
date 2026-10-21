const COOKIE='collector_session',MAX_BYTES=5*1024*1024;
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function cookie(request,name){for(const part of (request.headers.get('Cookie')||'').split(';')){const p=part.trim();if(p.startsWith(name+'='))return p.slice(name.length+1);}return '';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sha256(value){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
async function currentAdmin(request,env){const token=cookie(request,COOKIE);if(!token)return null;const a=await env.DB.prepare('SELECT id,is_admin,session_expires_at FROM accounts WHERE session_token_hash=? LIMIT 1').bind(await sha256(token)).first();return a&&Number(a.is_admin)===1&&a.session_expires_at&&Number(a.session_expires_at)>Date.now()?a:null;}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);if(!env.VENDOR_MEDIA)return json({ok:false,error:'image_storage_not_configured'},503);if(!await currentAdmin(request,env))return json({ok:false,error:'admin_required'},403);
 const kind=new URL(request.url).searchParams.get('kind');if(!['story','event'].includes(kind))return json({ok:false,error:'invalid_image_kind'},400);
 const type=(request.headers.get('content-type')||'').split(';')[0].toLowerCase(),ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/avif':'avif'}[type];if(!ext)return json({ok:false,error:'unsupported_image_type'},415);
 if(Number(request.headers.get('content-length')||0)>MAX_BYTES)return json({ok:false,error:'image_too_large'},413);
 try{const bytes=await request.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>MAX_BYTES)return json({ok:false,error:'image_too_large'},413);const prefix=kind==='story'?'pokereport':'events',key=prefix+'/'+crypto.randomUUID()+'.'+ext;await env.VENDOR_MEDIA.put(key,bytes,{httpMetadata:{contentType:type,cacheControl:'public, max-age=31536000, immutable'}});const url=new URL('/api/vendor/image',request.url);url.searchParams.set('key',key);return json({ok:true,key,url:url.toString()},201);}catch(error){console.error('Admin image upload failed',error);return json({ok:false,error:'image_upload_failed'},500);}
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
