const COOKIE='collector_session';
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function cookie(request,name){for(const part of (request.headers.get('Cookie')||'').split(';')){const p=part.trim();if(p.startsWith(name+'='))return p.slice(name.length+1);}return '';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');}
async function sha256(value){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
async function auth(request,env){const token=cookie(request,COOKIE);if(!token)return null;const a=await env.DB.prepare('SELECT id,session_expires_at FROM accounts WHERE session_token_hash=? LIMIT 1').bind(await sha256(token)).first();return a&&a.session_expires_at&&Number(a.session_expires_at)>Date.now()?a:null;}
async function ensureTable(db){await db.prepare(`CREATE TABLE IF NOT EXISTS collector_hashtags(tag TEXT PRIMARY KEY,display_tag TEXT NOT NULL,usage_count INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();}
export async function onRequestGet({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 try{await ensureTable(env.DB);const q=String(new URL(request.url).searchParams.get('q')||'').replace(/^#/,'').toLowerCase().slice(0,30);
 const r=await env.DB.prepare('SELECT display_tag AS tag,usage_count FROM collector_hashtags WHERE tag LIKE ? ORDER BY usage_count DESC,display_tag LIMIT 8').bind(q+'%').all();
 return json({ok:true,hashtags:r.results||[]});}catch(e){console.error('Hashtag lookup failed',e);return json({ok:false,error:'hashtag_lookup_failed'},500);}
}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 const account=await auth(request,env).catch(()=>null);if(!account)return json({ok:false,error:'login_required'},401);
 let data;try{data=await request.json();}catch{return json({ok:false,error:'invalid_json'},400);}
 const source=typeof data.text==='string'?data.text.slice(0,3000):'';
 const tags=[...new Set((source.match(/(^|\\s)#([a-zA-Z0-9_]{2,30})/g)||[]).map(x=>x.trim().slice(1)))].slice(0,20);
 try{await ensureTable(env.DB);for(const display of tags){const tag=display.toLowerCase();await env.DB.prepare(`INSERT INTO collector_hashtags(tag,display_tag,usage_count) VALUES(?,?,1) ON CONFLICT(tag) DO UPDATE SET usage_count=collector_hashtags.usage_count+1,display_tag=excluded.display_tag,updated_at=CURRENT_TIMESTAMP`).bind(tag,display).run();}
 return json({ok:true,recorded:tags.length});}catch(e){console.error('Hashtag record failed',e);return json({ok:false,error:'hashtag_record_failed'},500);}
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
