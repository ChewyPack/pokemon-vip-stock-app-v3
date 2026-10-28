const COOKIE='collector_session';
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function cookie(request,name){for(const part of (request.headers.get('Cookie')||'').split(';')){const p=part.trim();if(p.startsWith(name+'='))return p.slice(name.length+1);}return '';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sha256(value){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
function clean(v,max=1000){return typeof v==='string'?v.trim().slice(0,max):'';}
function cents(v){if(v===''||v==null)return null;const n=Number(v);return Number.isFinite(n)?Math.round(n*100):NaN;}
async function account(request,env){const token=cookie(request,COOKIE);if(!token)return null;const a=await env.DB.prepare('SELECT id,display_name,is_admin,session_expires_at,membership_status,membership_tier,membership_entitlement_tier FROM accounts WHERE session_token_hash=? LIMIT 1').bind(await sha256(token)).first();return a&&a.session_expires_at&&Number(a.session_expires_at)>Date.now()?a:null;}
function vendorPlus(a){const tier=v=>String(v||'').trim().toLowerCase().replace(/[_-]/g,' ').replace(/\s+/g,' ');return !!a&&(Number(a.is_admin||0)===1||(['active','trialing'].includes(String(a.membership_status||'').toLowerCase())&&[a.membership_tier,a.membership_entitlement_tier].some(v=>['vendor','vendor+','vendor plus'].includes(tier(v)))));}
async function schema(env){
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS event_buyer_requests (
 id INTEGER PRIMARY KEY AUTOINCREMENT,event_id INTEGER NOT NULL,buyer_account_id INTEGER NOT NULL,
 product_type TEXT NOT NULL DEFAULT 'cards' CHECK(product_type IN ('cards','sealed','graded','other')),
 title TEXT NOT NULL,details TEXT NOT NULL DEFAULT '',quantity INTEGER NOT NULL DEFAULT 1,
 max_budget_cents INTEGER,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','fulfilled')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 )`).run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS event_vending_registrations (id INTEGER PRIMARY KEY AUTOINCREMENT,event_id INTEGER NOT NULL,account_id INTEGER NOT NULL,booth_location TEXT NOT NULL DEFAULT '',key_items TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','withdrawn')),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(event_id,account_id))").run();
 await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_event_buyer_requests_event_status ON event_buyer_requests(event_id,status,created_at DESC)').run();
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS event_buyer_request_responses (
 id INTEGER PRIMARY KEY AUTOINCREMENT,request_id INTEGER NOT NULL,event_id INTEGER NOT NULL,vendor_account_id INTEGER NOT NULL,
 price_cents INTEGER NOT NULL,availability TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','buyer_on_way','sold','withdrawn')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(request_id,vendor_account_id),FOREIGN KEY(request_id) REFERENCES event_buyer_requests(id) ON DELETE CASCADE
 )`).run();
 await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_event_buyer_request_responses_request ON event_buyer_request_responses(request_id,status,created_at)').run();
}
async function eventInfo(env,id){return env.DB.prepare("SELECT id,title,event_date,status,event_type FROM poke_report_events WHERE id=? LIMIT 1").bind(id).first();}
async function load(env,eventId,user){
 const requests=await env.DB.prepare(`SELECT r.id,r.event_id,r.buyer_account_id,r.product_type,r.title,r.details,r.quantity,r.max_budget_cents,r.status,r.created_at,r.updated_at,
 COALESCE(NULLIF(a.display_name,''),'Collector') AS buyer_name
 FROM event_buyer_requests r JOIN accounts a ON a.id=r.buyer_account_id
 WHERE r.event_id=? AND (r.status='open' OR r.buyer_account_id=? OR ?=1)
 ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END,r.created_at DESC LIMIT 200`).bind(eventId,Number(user?.id||0),Number(user?.is_admin||0)).all();
 const out=[];
 for(const r of requests.results||[]){
  const responses=await env.DB.prepare(`SELECT p.id,p.request_id,p.vendor_account_id,p.price_cents,p.availability,p.notes,p.status,p.created_at,p.updated_at,
  COALESCE(NULLIF(v.shop_name,''),NULLIF(a.display_name,''),'Vendor+ member') AS vendor_name,
  COALESCE(cp.username,'') AS username,COALESCE(er.booth_location,'') AS booth_location
  FROM event_buyer_request_responses p JOIN accounts a ON a.id=p.vendor_account_id
  LEFT JOIN vendor_profiles v ON v.account_id=p.vendor_account_id LEFT JOIN collector_profiles cp ON cp.account_id=p.vendor_account_id
  LEFT JOIN event_vending_registrations er ON er.event_id=p.event_id AND er.account_id=p.vendor_account_id AND er.status='active'
  WHERE p.request_id=? AND p.status!='withdrawn' ORDER BY p.created_at ASC`).bind(r.id).all();
  out.push({...r,is_mine:Number(user?.id||0)===Number(r.buyer_account_id),responses:responses.results||[]});
 }
 const myVendor=user&&vendorPlus(user)?await env.DB.prepare("SELECT booth_location FROM event_vending_registrations WHERE event_id=? AND account_id=? AND status='active' LIMIT 1").bind(eventId,user.id).first():null;
 return {requests:out,can_vendor:!!myVendor||!!(user&&Number(user.is_admin||0)===1),vendor_booth_location:myVendor?.booth_location||'',can_post:!!user,user_id:Number(user?.id||0),is_vendor_plus:vendorPlus(user),signed_in:!!user};
}
export async function onRequestGet({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 try{await schema(env);const url=new URL(request.url);const user=await account(request,env);
 if(url.searchParams.get('admin')==='1'){
  if(!user)return json({ok:false,error:'login_required'},401);
  if(Number(user.is_admin||0)!==1)return json({ok:false,error:'admin_required'},403);
  const events=await env.DB.prepare("SELECT id,title,event_date,status FROM poke_report_events ORDER BY event_date DESC LIMIT 300").all();
  const all=[];for(const event of (events.results||[])){const loaded=await load(env,Number(event.id),user);for(const item of loaded.requests)all.push({...item,event_title:event.title,event_date:event.event_date});}
  return json({ok:true,requests:all});
 }
 const eventId=Number(url.searchParams.get('event_id')||0);if(!Number.isSafeInteger(eventId)||eventId<1)return json({ok:false,error:'valid_event_id_required'},400);
 const event=await eventInfo(env,eventId);if(!event||event.status!=='published')return json({ok:false,error:'event_not_found'},404);
 return json({ok:true,event:{id:event.id,title:event.title,event_date:event.event_date},...await load(env,eventId,user),signed_in:!!user,is_vendor_plus:vendorPlus(user)});
 }catch(e){console.error('Event buyer requests read failed',e);return json({ok:false,error:'event_requests_unavailable'},500);}
}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 const origin=request.headers.get('Origin');if(origin){try{if(new URL(origin).origin!==new URL(request.url).origin)return json({ok:false,error:'origin_not_allowed'},403);}catch{return json({ok:false,error:'origin_not_allowed'},403);}}
 const user=await account(request,env);if(!user)return json({ok:false,error:'login_required',message:'Sign in to post or respond to a show request.'},401);
 try{await schema(env);const d=await request.json().catch(()=>null);if(!d||typeof d!=='object')return json({ok:false,error:'bad_request'},400);
 const eventId=Number(d.event_id||0);if(!Number.isSafeInteger(eventId)||eventId<1)return json({ok:false,error:'valid_event_id_required'},400);
 const event=await eventInfo(env,eventId);if(!event||event.status!=='published')return json({ok:false,error:'event_not_found'},404);
 const action=clean(d.action,30);
 if(['create','respond','response_status'].includes(action)&&String(event.event_date||'')<new Date().toISOString().slice(0,10))return json({ok:false,error:'event_is_past',message:'Requests are closed for past events.'},409);
 if(action==='create'){
  const title=clean(d.title,160),details=clean(d.details,1200),type=clean(d.product_type,20),quantity=Number(d.quantity||1),budget=cents(d.max_budget);
  if(!title)return json({ok:false,error:'title_required'},400);
  if(!['cards','sealed','graded','other'].includes(type))return json({ok:false,error:'invalid_product_type'},400);
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>100)return json({ok:false,error:'invalid_quantity'},400);
  if(budget!==null&&(!Number.isSafeInteger(budget)||budget<0||budget>100000000))return json({ok:false,error:'invalid_budget'},400);
  await env.DB.prepare("INSERT INTO event_buyer_requests(event_id,buyer_account_id,product_type,title,details,quantity,max_budget_cents) VALUES(?,?,?,?,?,?,?)").bind(eventId,user.id,type,title,details,quantity,budget).run();
  return json({ok:true,created:true,...await load(env,eventId,user)});
 }
 const requestId=Number(d.request_id||0);if(!Number.isSafeInteger(requestId)||requestId<1)return json({ok:false,error:'valid_request_id_required'},400);
 if(action==='admin_delete'){
  if(Number(user.is_admin||0)!==1)return json({ok:false,error:'admin_required'},403);
  await env.DB.batch([
   env.DB.prepare('DELETE FROM event_buyer_request_responses WHERE request_id=?').bind(requestId),
   env.DB.prepare('DELETE FROM event_buyer_requests WHERE id=? AND event_id=?').bind(requestId,eventId)
  ]);
  return json({ok:true,deleted:true});
 }
 const target=await env.DB.prepare('SELECT id,event_id,buyer_account_id,status FROM event_buyer_requests WHERE id=? AND event_id=? LIMIT 1').bind(requestId,eventId).first();
 if(!target)return json({ok:false,error:'request_not_found'},404);
 if(action==='close'){
  if(Number(target.buyer_account_id)!==Number(user.id)&&Number(user.is_admin||0)!==1)return json({ok:false,error:'request_owner_required'},403);
  const status=clean(d.status,20)==='fulfilled'?'fulfilled':'closed';
  await env.DB.prepare("UPDATE event_buyer_requests SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status,requestId).run();
  return json({ok:true,closed:true,...await load(env,eventId,user)});
 }
 if(action==='respond'||action==='response_status'){
  if(!vendorPlus(user))return json({ok:false,error:'vendor_plus_required',message:'An active Vendor+ membership is required to respond to buyer requests.'},403);
  const booth=await env.DB.prepare("SELECT booth_location FROM event_vending_registrations WHERE event_id=? AND account_id=? AND status='active' LIMIT 1").bind(eventId,user.id).first();
  if(!booth&&Number(user.is_admin||0)!==1)return json({ok:false,error:'event_vendor_registration_required',message:'Add your Vendor+ listing and booth location for this show before responding.'},403);
  if(action==='respond'){
   if(target.status!=='open')return json({ok:false,error:'request_closed',message:'This buyer request is no longer open.'},409);
   const price=cents(d.price);if(!Number.isSafeInteger(price)||price<0||price>100000000)return json({ok:false,error:'invalid_price'},400);
   const availability=clean(d.availability,160),notes=clean(d.notes,700);
   await env.DB.prepare("INSERT INTO event_buyer_request_responses(request_id,event_id,vendor_account_id,price_cents,availability,notes) VALUES(?,?,?,?,?,?) ON CONFLICT(request_id,vendor_account_id) DO UPDATE SET price_cents=excluded.price_cents,availability=excluded.availability,notes=excluded.notes,status='available',updated_at=CURRENT_TIMESTAMP").bind(requestId,eventId,user.id,price,availability,notes).run();
  }else{
   const status=clean(d.status,30);if(!['available','buyer_on_way','sold','withdrawn'].includes(status))return json({ok:false,error:'invalid_response_status'},400);
   const result=await env.DB.prepare('UPDATE event_buyer_request_responses SET status=?,updated_at=CURRENT_TIMESTAMP WHERE request_id=? AND vendor_account_id=?').bind(status,requestId,user.id).run();
   if(!result.meta?.changes)return json({ok:false,error:'vendor_response_not_found'},404);
  }
  return json({ok:true,saved:true,...await load(env,eventId,user)});
 }
 return json({ok:false,error:'unknown_action'},400);
 }catch(e){console.error('Event buyer request save failed',e);return json({ok:false,error:'event_request_save_failed'},500);}
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
