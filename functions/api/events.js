const COOKIE='collector_session';
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function cookie(request,name){for(const part of (request.headers.get('Cookie')||'').split(';')){const p=part.trim();if(p.startsWith(name+'='))return p.slice(name.length+1);}return '';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sha256(value){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
function clean(v,max=1000){return typeof v==='string'?v.trim().slice(0,max):'';}
async function ensureTable(env){
 await env.DB.prepare(\`CREATE TABLE IF NOT EXISTS poke_report_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',
 event_type TEXT NOT NULL DEFAULT 'show',event_date TEXT NOT NULL,start_time TEXT NOT NULL DEFAULT '',
 end_time TEXT NOT NULL DEFAULT '',venue TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',
 city TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT '',state_name TEXT NOT NULL DEFAULT '',
 zip TEXT NOT NULL DEFAULT '',url TEXT NOT NULL DEFAULT '',price TEXT NOT NULL DEFAULT '',
 image_url TEXT NOT NULL DEFAULT '',badge TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 )\`).run();
 await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_poke_report_events_public_date ON poke_report_events(status,event_date)').run();
}
async function account(request,env){const token=cookie(request,COOKIE);if(!token)return null;const a=await env.DB.prepare('SELECT id,is_admin,session_expires_at FROM accounts WHERE session_token_hash=? LIMIT 1').bind(await sha256(token)).first();return a&&a.session_expires_at&&Number(a.session_expires_at)>Date.now()?a:null;}
async function admin(request,env){const a=await account(request,env);if(!a)return {response:json({ok:false,error:'login_required'},401)};if(Number(a.is_admin)!==1)return {response:json({ok:false,error:'admin_required'},403)};return {a};}
const FIELDS=['title','description','event_type','event_date','start_time','end_time','venue','address','city','state','state_name','zip','url','price','image_url','badge','status'];
export async function onRequestGet({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 try{await ensureTable(env);const url=new URL(request.url);const adminView=url.searchParams.get('admin')==='1';if(adminView){const access=await admin(request,env);if(access.response)return access.response;const rows=await env.DB.prepare('SELECT * FROM poke_report_events ORDER BY event_date DESC,id DESC LIMIT 500').all();return json({ok:true,events:rows.results||[]});}
 const from=clean(url.searchParams.get('from'),10),to=clean(url.searchParams.get('to'),10),type=clean(url.searchParams.get('type'),30),state=clean(url.searchParams.get('state'),10),q=clean(url.searchParams.get('q'),120).toLowerCase();
 let rows=await env.DB.prepare("SELECT * FROM poke_report_events WHERE status='published' ORDER BY event_date ASC,id ASC LIMIT 500").all();
 let list=rows.results||[];if(from)list=list.filter(e=>e.event_date>=from);if(to)list=list.filter(e=>e.event_date<=to);if(type)list=list.filter(e=>e.event_type===type);if(state)list=list.filter(e=>e.state===state);
 if(q)list=list.filter(e=>[e.title,e.description,e.venue,e.city,e.state_name,e.address].join(' ').toLowerCase().includes(q));
 return json({ok:true,events:list});
 }catch(error){console.error('Poke Report events read failed',error);return json({ok:false,error:'events_read_failed'},500);}
}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);const access=await admin(request,env);if(access.response)return access.response;
 let d;try{d=await request.json();}catch{return json({ok:false,error:'bad_request'},400);}
 const id=Number(d.id||0),data={};
 for(const f of FIELDS)data[f]=clean(d[f],f==='description'?4000:(f==='title'?180:(f==='url'||f==='image_url'?1000:f==='address'?300:f==='badge'?80:160)));
 data.status=data.status==='published'?'published':'draft';
 if(!data.title||!data.event_date)return json({ok:false,error:'title_and_date_required'},400);
 if(!['show','trade','tournament','store','restock','release'].includes(data.event_type))return json({ok:false,error:'invalid_event_type'},400);
 if(data.url){try{if(new URL(data.url).protocol!=='https:')return json({ok:false,error:'event_url_must_use_https'},400);}catch{return json({ok:false,error:'invalid_event_url'},400);}}
 if(data.image_url){try{const u=new URL(data.image_url);if(u.protocol!=='https:'||u.pathname!=='/api/vendor/image'||!u.searchParams.get('key'))return json({ok:false,error:'image_must_be_uploaded'},400);}catch{return json({ok:false,error:'image_must_be_uploaded'},400);}}
 try{await ensureTable(env);if(id){const old=await env.DB.prepare('SELECT id FROM poke_report_events WHERE id=?').bind(id).first();if(!old)return json({ok:false,error:'event_not_found'},404);await env.DB.prepare('UPDATE poke_report_events SET title=?,description=?,event_type=?,event_date=?,start_time=?,end_time=?,venue=?,address=?,city=?,state=?,state_name=?,zip=?,url=?,price=?,image_url=?,badge=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(data.title,data.description,data.event_type,data.event_date,data.start_time,data.end_time,data.venue,data.address,data.city,data.state,data.state_name,data.zip,data.url,data.price,data.image_url,data.badge,data.status,id).run();}
 else{await env.DB.prepare('INSERT INTO poke_report_events (title,description,event_type,event_date,start_time,end_time,venue,address,city,state,state_name,zip,url,price,image_url,badge,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(data.title,data.description,data.event_type,data.event_date,data.start_time,data.end_time,data.venue,data.address,data.city,data.state,data.state_name,data.zip,data.url,data.price,data.image_url,data.badge,data.status).run();}
 const saved=id?await env.DB.prepare('SELECT * FROM poke_report_events WHERE id=?').bind(id).first():await env.DB.prepare('SELECT * FROM poke_report_events ORDER BY id DESC LIMIT 1').first();return json({ok:true,event:saved});
 }catch(error){console.error('Poke Report event save failed',error);return json({ok:false,error:'event_save_failed'},500);}
}
export async function onRequestDelete({request,env}){if(!env.DB)return json({ok:false,error:'database_not_configured'},500);const access=await admin(request,env);if(access.response)return access.response;const id=Number(new URL(request.url).searchParams.get('id'));if(!Number.isSafeInteger(id)||id<1)return json({ok:false,error:'valid_event_id_required'},400);try{await ensureTable(env);const result=await env.DB.prepare('DELETE FROM poke_report_events WHERE id=?').bind(id).run();if(!result.meta||result.meta.changes!==1)return json({ok:false,error:'event_not_found'},404);return json({ok:true});}catch(error){console.error('Poke Report event delete failed',error);return json({ok:false,error:'event_delete_failed'},500);}}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
