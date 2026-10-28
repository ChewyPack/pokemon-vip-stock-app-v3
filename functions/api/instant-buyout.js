import { sendWebPush } from '../_lib/web-push.js';
const COOKIE='collector_session';
const CATEGORIES=new Set(['bulk','singles','slabs','sealed','collection','other']);
const STATUSES=new Set(['submitted','reviewing','offer_ready','accepted','declined','completed']);
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function cookie(request,name){for(const part of (request.headers.get('Cookie')||'').split(';')){const p=part.trim();if(p.startsWith(name+'='))return p.slice(name.length+1);}return '';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sha256(value){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
function clean(v,max=1000){return String(v??'').trim().slice(0,max);}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
async function sendBuyoutNotice(env,row){
 const from=clean(env.INSTANT_BUYOUT_FROM||env.LINE_SERVICE_FROM||env.PASSWORD_RESET_FROM,250);
 if(!env.RESEND_API_KEY||!from)return {sent:false,error:'email_not_configured'};
 const subject='New PokePrizePool instant buyout request #'+row.id;
 const photoLinks=String(row.photo_urls||'').split(/\n/).filter(Boolean).map((url,index)=>'<li><a href="'+escapeHtml(url)+'">Photo '+(index+1)+'</a></li>').join('')||'<li>Not provided</li>';
 const summary=[
  'New Instant Buyout request #'+row.id,
  'Submitted by: '+row.seller_name+' <'+row.seller_email+'>',
  'Category: '+row.category,
  'Title: '+row.title,
  'Quantity / lot size: '+(row.quantity||'Not specified'),
  'Asking price: '+(row.asking_price_cents==null?'Not provided':'$'+(Number(row.asking_price_cents)/100).toFixed(2)),
  '',
  'Details:',row.details,'',
  'Condition / grading notes:',row.condition_notes||'Not provided','',
  'Uploaded photos (open each link while signed in as an administrator):',row.photo_urls||'Not provided','',
  'Review this request in PokePrizePool Admin: https://pokeprizepool.com/admin.html'
 ].join('\n');
 let response;
 try{
  response=await fetch('https://api.resend.com/emails',{
   method:'POST',
   headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},
   body:JSON.stringify({
    from,to:['pokeprizepool@gmail.com'],subject,text:summary,
    html:'<h2>New Instant Buyout request #'+row.id+'</h2><p><strong>Submitted by:</strong> '+escapeHtml(row.seller_name)+' &lt;'+escapeHtml(row.seller_email)+'&gt;</p><p><strong>Category:</strong> '+escapeHtml(row.category)+'<br><strong>Title:</strong> '+escapeHtml(row.title)+'<br><strong>Quantity:</strong> '+escapeHtml(row.quantity||'Not specified')+'<br><strong>Asking price:</strong> '+escapeHtml(row.asking_price_cents==null?'Not provided':'$'+(Number(row.asking_price_cents)/100).toFixed(2))+'</p><h3>Details</h3><pre style="font:14px/1.5 Arial,sans-serif;white-space:pre-wrap">'+escapeHtml(row.details)+'</pre><h3>Condition / grading notes</h3><p>'+escapeHtml(row.condition_notes||'Not provided')+'</p><h3>Uploaded photos</h3><ul>'+photoLinks+'</ul><p><a href="https://pokeprizepool.com/admin.html">Review in PokePrizePool Admin</a></p>'
   })
  });
 }catch(error){
  console.error('Instant Buyout notification request failed:',String(error).slice(0,300));
  return {sent:false,error:'email_delivery_failed'};
 }
 if(!response.ok){
  const detail=await response.text().catch(()=> '');
  console.error('Instant Buyout notification failed:',response.status,detail.slice(0,300));
  return {sent:false,error:'email_provider_rejected_'+response.status};
 }
 return {sent:true,error:''};
}
function dollarsToCents(v){if(v===undefined||v===null||String(v).trim()==='')return null;const n=Number(v);if(!Number.isFinite(n)||n<0||n>10000000)return NaN;return Math.round(n*100);}
async function currentAccount(request,env){
 const token=cookie(request,COOKIE);if(!token)return null;
 const a=await env.DB.prepare('SELECT id,display_name,email,is_admin,session_expires_at,membership_status,membership_tier,membership_entitlement_tier FROM accounts WHERE session_token_hash=? LIMIT 1').bind(await sha256(token)).first();
 return a&&a.session_expires_at&&Number(a.session_expires_at)>Date.now()?a:null;
}
function hasVendorPlus(a){return !!a&&(Number(a.is_admin||0)===1||(String(a.membership_status||'').toLowerCase()==='active'&&(String(a.membership_entitlement_tier||'').toLowerCase()==='vendor'||String(a.membership_tier||'').toLowerCase()==='vendor')));}
async function ensureOfferSchema(env){try{await env.DB.prepare('ALTER TABLE instant_buyout_requests ADD COLUMN vendor_visible INTEGER NOT NULL DEFAULT 0').run();}catch(_){} await env.DB.prepare("CREATE TABLE IF NOT EXISTS instant_buyout_vendor_offers (id INTEGER PRIMARY KEY AUTOINCREMENT,request_id INTEGER NOT NULL,vendor_account_id INTEGER NOT NULL,offer_amount_cents INTEGER NOT NULL CHECK(offer_amount_cents>=0),offer_notes TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','accepted','declined')),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(request_id,vendor_account_id),FOREIGN KEY(request_id) REFERENCES instant_buyout_requests(id) ON DELETE CASCADE,FOREIGN KEY(vendor_account_id) REFERENCES accounts(id) ON DELETE CASCADE)").run();await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_buyout_vendor_offers_vendor ON instant_buyout_vendor_offers(vendor_account_id,status,created_at DESC)').run();await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_buyout_vendor_offers_request ON instant_buyout_vendor_offers(request_id,status,created_at DESC)').run();}
async function notifyAccount(env,id,type,title,body,url,data){try{const prefs=await env.DB.prepare('SELECT in_app_enabled,browser_push_enabled FROM notification_preferences WHERE account_id=? LIMIT 1').bind(id).first().catch(()=>null);if(!prefs||Number(prefs.in_app_enabled)!==0)await env.DB.prepare('INSERT INTO notifications (account_id,notification_type,title,body,url,data_json) VALUES (?,?,?,?,?,?)').bind(id,type,title,body,url,JSON.stringify(data||{})).run();if(prefs&&Number(prefs.browser_push_enabled)===1&&env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY){const subs=await env.DB.prepare('SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE account_id=?').bind(id).all().catch(()=>({results:[]}));await Promise.all((subs.results||[]).map(async sub=>{try{const response=await sendWebPush(sub,{title,body,url,data:data||{}},env);if(response.status===404||response.status===410)await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(sub.endpoint).run();}catch(error){console.error('Buyout push alert failed',String(error&&error.message||error).slice(0,160));}}));}return !prefs||Number(prefs.in_app_enabled)!==0;}catch(error){console.error('Buyout notification failed',String(error&&error.message||error).slice(0,160));return false;}}
async function notifyVendorPlus(env,requestId,sellerAccountId,title){const vendors=await env.DB.prepare("SELECT id FROM accounts WHERE id<>? AND membership_status='active' AND (LOWER(COALESCE(membership_entitlement_tier,''))='vendor' OR LOWER(COALESCE(membership_tier,''))='vendor')").bind(sellerAccountId).all();let count=0;for(const v of vendors.results||[])if(await notifyAccount(env,Number(v.id),'buyout_opportunity','New Instant Buyout opportunity',clean(title,140)+' is available for an offer.','/instant-buyout.html',{request_id:requestId}))count++;return count;}

async function emailVendorPlus(env,row){
 const from=clean(env.INSTANT_BUYOUT_FROM||env.LINE_SERVICE_FROM||env.PASSWORD_RESET_FROM,250);if(!env.RESEND_API_KEY||!from)return {sent:0,failed:true};
 const vendors=await env.DB.prepare("SELECT id,email FROM accounts WHERE email IS NOT NULL AND email<>'' AND membership_status='active' AND (LOWER(COALESCE(membership_entitlement_tier,''))='vendor' OR LOWER(COALESCE(membership_tier,''))='vendor')").all();
 let sent=0;for(const v of vendors.results||[]){try{const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from,to:[v.email],subject:'Vendor+ buyout opportunity: '+clean(row.title,120),text:'A new PokePrizePool buyout request has been approved for Vendor+ offers.\n\nTitle: '+row.title+'\nCategory: '+row.category+'\nQuantity: '+(row.quantity||'Not specified')+'\nAsking price: '+(row.asking_price_cents==null?'Not provided':'$'+(Number(row.asking_price_cents)/100).toFixed(2))+'\n\nReview it and make an offer: https://pokeprizepool.com/instant-buyout.html?tab=requests'})});if(response.ok)sent++;}catch(_){}}return {sent,failed:sent===0};}
function shape(row,admin){
 const out={id:row.id,vendor_visible:Number(row.vendor_visible||0),category:row.category,title:row.title,details:row.details,quantity:row.quantity,condition_notes:row.condition_notes,photo_urls:row.photo_urls,asking_price_cents:row.asking_price_cents,status:row.status,offer_amount_cents:row.offer_amount_cents,offer_notes:row.offer_notes,partner_vendor_name:row.partner_vendor_name,created_at:row.created_at,updated_at:row.updated_at};
 if(admin){out.seller_name=row.display_name||'Collector';out.seller_email=row.email||'';out.partner_vendor_contact=row.partner_vendor_contact||'';}
 return out;
}
export async function onRequestGet({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 try{
  const account=await currentAccount(request,env);if(!account)return json({ok:false,error:'login_required'},401);await ensureOfferSchema(env);
  const isAdmin=Number(account.is_admin)===1,isVendorPlus=hasVendorPlus(account)&&!isAdmin;
  const sql=isAdmin?'SELECT r.*,a.display_name,a.email FROM instant_buyout_requests r JOIN accounts a ON a.id=r.account_id ORDER BY r.created_at DESC LIMIT 200':'SELECT * FROM instant_buyout_requests WHERE account_id=? ORDER BY created_at DESC LIMIT 100';
  const result=isAdmin?await env.DB.prepare(sql).all():await env.DB.prepare(sql).bind(account.id).all();const requests=(result.results||[]).map(r=>shape(r,isAdmin));
  if(!isAdmin){const all=await env.DB.prepare("SELECT o.id,o.request_id,o.offer_amount_cents,o.offer_notes,o.status,o.created_at,o.updated_at,COALESCE(NULLIF(v.shop_name,''),NULLIF(a.display_name,''),'Vendor+ member') AS vendor_name,COALESCE(p.username,'') AS vendor_username FROM instant_buyout_vendor_offers o JOIN instant_buyout_requests r ON r.id=o.request_id JOIN accounts a ON a.id=o.vendor_account_id LEFT JOIN vendor_profiles v ON v.account_id=a.id LEFT JOIN collector_profiles p ON p.account_id=a.id WHERE r.account_id=? ORDER BY o.created_at DESC").bind(account.id).all();const by={};for(const o of all.results||[])(by[o.request_id]||(by[o.request_id]=[])).push(o);for(const r of requests)r.vendor_offers=by[r.id]||[];}
  let opportunities=[],my_offers=[],vendor_commerce=[];
  if(isVendorPlus){const found=await env.DB.prepare("SELECT r.id,r.account_id,r.category,r.title,r.details,r.quantity,r.condition_notes,r.photo_urls,r.asking_price_cents,r.status,r.created_at,COALESCE(NULLIF(p.username,''),NULLIF(a.display_name,''),'Collector') AS seller_name,COALESCE(p.username,'') AS seller_username FROM instant_buyout_requests r JOIN accounts a ON a.id=r.account_id LEFT JOIN collector_profiles p ON p.account_id=a.id WHERE r.account_id<>? AND r.vendor_visible=1 AND r.status NOT IN ('accepted','declined','completed') ORDER BY r.created_at DESC LIMIT 200").bind(account.id).all();opportunities=found.results||[];
   const mine=await env.DB.prepare("SELECT o.id,o.request_id,o.offer_amount_cents,o.offer_notes,o.status,o.created_at,o.updated_at,r.title,r.status AS request_status,COALESCE(NULLIF(p.username,''),NULLIF(a.display_name,''),'Collector') AS seller_name,COALESCE(p.username,'') AS seller_username FROM instant_buyout_vendor_offers o JOIN instant_buyout_requests r ON r.id=o.request_id JOIN accounts a ON a.id=r.account_id LEFT JOIN collector_profiles p ON p.account_id=a.id WHERE o.vendor_account_id=? ORDER BY o.updated_at DESC LIMIT 200").bind(account.id).all();my_offers=mine.results||[];}
  if(isAdmin){const vendors=await env.DB.prepare("SELECT a.id,a.display_name,a.email,COALESCE(v.ticket_sales_approved,0) AS ticket_sales_approved,COALESCE(v.booth_sales_approved,0) AS booth_sales_approved,COALESCE(v.review_notes,'') AS review_notes FROM accounts a LEFT JOIN vendor_commerce_approvals v ON v.account_id=a.id WHERE a.membership_status='active' AND (a.membership_entitlement_tier='vendor' OR a.membership_tier='vendor') ORDER BY a.display_name COLLATE NOCASE").all();vendor_commerce=vendors.results||[];}
  return json({ok:true,is_admin:isAdmin,is_vendor_plus:isVendorPlus,requests,opportunities,my_offers,vendor_commerce});
 }catch(error){console.error('Instant Buyout load failed',error);return json({ok:false,error:'instant_buyout_unavailable'},500);}
}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 try{
  const account=await currentAccount(request,env);if(!account)return json({ok:false,error:'login_required'},401);
  let d;try{d=await request.json();}catch{return json({ok:false,error:'bad_request'},400);}
  const action=clean(d.action,40);
  await ensureOfferSchema(env);
  if(action==='submit'){
   const category=clean(d.category,20),title=clean(d.title,160),details=clean(d.details,3000),quantity=clean(d.quantity,120),condition=clean(d.condition_notes,500);
   const photos=clean(d.photo_urls,2000).split(/\s*,\s*|\n/).filter(Boolean).slice(0,5);
   const asking=dollarsToCents(d.asking_price);
   if(!CATEGORIES.has(category)||!title||!details)return json({ok:false,error:'required_fields_missing'},400);
   if(Number.isNaN(asking))return json({ok:false,error:'invalid_asking_price'},400);
   if(photos.some(url=>{try{const parsed=new URL(url);return parsed.protocol!=='https:'||parsed.pathname!=='/api/instant-buyout-photo'||!parsed.searchParams.get('key');}catch{return true;}}))return json({ok:false,error:'photos_must_be_uploaded'},400);
   const created=await env.DB.prepare('INSERT INTO instant_buyout_requests (account_id,category,title,details,quantity,condition_notes,photo_urls,asking_price_cents) VALUES (?,?,?,?,?,?,?,?)')
    .bind(account.id,category,title,details,quantity,condition,photos.join('\n'),asking).run();
   const id=Number(created.meta?.last_row_id);
   const notice=await sendBuyoutNotice(env,{id,seller_name:account.display_name||'Collector',seller_email:account.email||'',category,title,details,quantity,condition_notes:condition,photo_urls:photos.join('\n'),asking_price_cents:asking});
   
   return json({ok:true,id,status:'submitted',email_sent:notice.sent,email_error:notice.sent?null:notice.error},201);
  }
  if(action==='delete_request'){
   const id=Number(d.id);if(!Number.isSafeInteger(id)||id<1)return json({ok:false,error:'invalid_request'},400);
   const item=await env.DB.prepare('SELECT id,account_id FROM instant_buyout_requests WHERE id=? LIMIT 1').bind(id).first();if(!item)return json({ok:false,error:'request_not_found'},404);
   if(Number(account.is_admin)!==1&&Number(item.account_id)!==Number(account.id))return json({ok:false,error:'admin_required'},403);
   await env.DB.prepare('DELETE FROM instant_buyout_vendor_offers WHERE request_id=?').bind(id).run().catch(()=>{});
   await env.DB.prepare('DELETE FROM instant_buyout_requests WHERE id=?').bind(id).run();return json({ok:true});
  }
  if(action==='publish_request'){
   if(Number(account.is_admin)!==1)return json({ok:false,error:'admin_required'},403);
   const id=Number(d.id);if(!Number.isSafeInteger(id)||id<1)return json({ok:false,error:'invalid_request'},400);
   const row=await env.DB.prepare('SELECT r.*,a.display_name,a.email FROM instant_buyout_requests r JOIN accounts a ON a.id=r.account_id WHERE r.id=? LIMIT 1').bind(id).first();if(!row)return json({ok:false,error:'request_not_found'},404);
   await env.DB.prepare('UPDATE instant_buyout_requests SET vendor_visible=1,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(id).run();
   const alerted=await notifyVendorPlus(env,id,Number(row.account_id),row.title);const emailed=await emailVendorPlus(env,row);
   return json({ok:true,vendor_alert_count:alerted,vendor_email_count:emailed.sent,email_failed:emailed.failed});
  }
  if(action==='vendor_offer'){
   if(!hasVendorPlus(account)||Number(account.is_admin)===1)return json({ok:false,error:'vendor_plus_required'},403);await ensureOfferSchema(env);
   const requestId=Number(d.request_id),amount=dollarsToCents(d.offer_amount),notes=clean(d.offer_notes,1200);if(!Number.isSafeInteger(requestId)||requestId<1||amount===null||Number.isNaN(amount))return json({ok:false,error:'valid_request_and_offer_required'},400);
   const item=await env.DB.prepare("SELECT id,account_id,title,status FROM instant_buyout_requests WHERE id=? LIMIT 1").bind(requestId).first();if(!item)return json({ok:false,error:'request_not_found'},404);if(Number(item.account_id)===Number(account.id))return json({ok:false,error:'cannot_offer_on_own_request'},403);if(['accepted','declined','completed'].includes(String(item.status)))return json({ok:false,error:'request_no_longer_accepting_offers'},409);
   const old=await env.DB.prepare('SELECT id,status FROM instant_buyout_vendor_offers WHERE request_id=? AND vendor_account_id=? LIMIT 1').bind(requestId,account.id).first();if(old&&old.status==='accepted')return json({ok:false,error:'offer_already_accepted'},409);
   await env.DB.prepare("INSERT INTO instant_buyout_vendor_offers (request_id,vendor_account_id,offer_amount_cents,offer_notes,status) VALUES (?,?,?,?,'submitted') ON CONFLICT(request_id,vendor_account_id) DO UPDATE SET offer_amount_cents=excluded.offer_amount_cents,offer_notes=excluded.offer_notes,status='submitted',updated_at=CURRENT_TIMESTAMP WHERE instant_buyout_vendor_offers.status!='accepted'").bind(requestId,account.id,amount,notes).run();
   const confirmed=await env.DB.prepare("SELECT id FROM instant_buyout_vendor_offers WHERE request_id=? AND vendor_account_id=? AND status='submitted' LIMIT 1").bind(requestId,account.id).first();if(!confirmed)return json({ok:false,error:'offer_already_accepted'},409);
   await notifyAccount(env,Number(item.account_id),'buyout_offer','A Vendor+ member made an offer','A Vendor+ member submitted an offer for '+clean(item.title,120)+'.','/instant-buyout.html',{request_id:requestId,offer_id:confirmed.id});return json({ok:true,offer_id:confirmed.id});
  }
  if(action==='seller_offer_response'){
   await ensureOfferSchema(env);const offerId=Number(d.offer_id),decision=clean(d.decision,20);if(!Number.isSafeInteger(offerId)||offerId<1||!['accept','decline'].includes(decision))return json({ok:false,error:'invalid_offer_response'},400);
   const offer=await env.DB.prepare("SELECT o.id,o.request_id,o.vendor_account_id,o.offer_amount_cents,o.offer_notes,o.status,r.account_id AS seller_account_id,r.status AS request_status,r.title,COALESCE(NULLIF(v.shop_name,''),NULLIF(a.display_name,''),'Vendor+ member') AS vendor_name FROM instant_buyout_vendor_offers o JOIN instant_buyout_requests r ON r.id=o.request_id JOIN accounts a ON a.id=o.vendor_account_id LEFT JOIN vendor_profiles v ON v.account_id=a.id WHERE o.id=? LIMIT 1").bind(offerId).first();if(!offer)return json({ok:false,error:'offer_not_found'},404);if(Number(offer.seller_account_id)!==Number(account.id))return json({ok:false,error:'offer_response_forbidden'},403);if(offer.status!=='submitted'||['accepted','declined','completed'].includes(String(offer.request_status)))return json({ok:false,error:'offer_no_longer_available'},409);
   if(decision==='accept'){const update=await env.DB.prepare("UPDATE instant_buyout_requests SET status='accepted',offer_amount_cents=?,offer_notes=?,partner_vendor_name=?,partner_vendor_contact='',updated_at=CURRENT_TIMESTAMP WHERE id=? AND account_id=? AND status NOT IN ('accepted','declined','completed')").bind(offer.offer_amount_cents,offer.offer_notes,offer.vendor_name,offer.request_id,account.id).run();if(!update.meta?.changes)return json({ok:false,error:'request_no_longer_accepting_offers'},409);await env.DB.prepare("UPDATE instant_buyout_vendor_offers SET status=CASE WHEN id=? THEN 'accepted' ELSE CASE WHEN status='submitted' THEN 'declined' ELSE status END END,updated_at=CURRENT_TIMESTAMP WHERE request_id=?").bind(offerId,offer.request_id).run();await notifyAccount(env,Number(offer.vendor_account_id),'buyout_offer_accepted','Your buyout offer was accepted','The seller accepted your offer for '+clean(offer.title,120)+'.','/instant-buyout.html',{request_id:offer.request_id,offer_id:offerId});const other=await env.DB.prepare("SELECT vendor_account_id FROM instant_buyout_vendor_offers WHERE request_id=? AND id<>? AND status='declined'").bind(offer.request_id,offerId).all();for(const v of other.results||[])await notifyAccount(env,Number(v.vendor_account_id),'buyout_offer_declined','Buyout listing closed','The seller accepted another offer for '+clean(offer.title,120)+'.','/instant-buyout.html',{request_id:offer.request_id});}
   else{const update=await env.DB.prepare("UPDATE instant_buyout_vendor_offers SET status='declined',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='submitted'").bind(offerId).run();if(!update.meta?.changes)return json({ok:false,error:'offer_no_longer_available'},409);await notifyAccount(env,Number(offer.vendor_account_id),'buyout_offer_declined','Your buyout offer was declined','The seller declined your offer for '+clean(offer.title,120)+'.','/instant-buyout.html',{request_id:offer.request_id,offer_id:offerId});}
   return json({ok:true});
  }
  if(action==='admin_vendor_approval'){
   if(Number(account.is_admin)!==1)return json({ok:false,error:'admin_required'},403);
   const vendorId=Number(d.account_id),ticket=d.ticket_sales_approved===true||d.ticket_sales_approved===1,booth=d.booth_sales_approved===true||d.booth_sales_approved===1,reviewNotes=clean(d.review_notes,1000);
   if(!Number.isInteger(vendorId)||vendorId<1)return json({ok:false,error:'invalid_vendor'},400);
   const target=await env.DB.prepare("SELECT id FROM accounts WHERE id=? AND membership_status='active' AND (membership_entitlement_tier='vendor' OR membership_tier='vendor') LIMIT 1").bind(vendorId).first();
   if(!target)return json({ok:false,error:'vendor_not_found'},404);
   await env.DB.prepare("INSERT INTO vendor_commerce_approvals (account_id,ticket_sales_approved,booth_sales_approved,reviewed_by_account_id,review_notes,reviewed_at,updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(account_id) DO UPDATE SET ticket_sales_approved=excluded.ticket_sales_approved,booth_sales_approved=excluded.booth_sales_approved,reviewed_by_account_id=excluded.reviewed_by_account_id,review_notes=excluded.review_notes,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP").bind(vendorId,ticket?1:0,booth?1:0,account.id,reviewNotes).run();
   return json({ok:true});
  }
  if(action==='admin_update'){
   if(Number(account.is_admin)!==1)return json({ok:false,error:'admin_required'},403);
   const id=Number(d.id),status=clean(d.status,30),offer=dollarsToCents(d.offer_amount),notes=clean(d.offer_notes,2000),vendor=clean(d.partner_vendor_name,160),contact=clean(d.partner_vendor_contact,300);
   if(!Number.isInteger(id)||id<1||!STATUSES.has(status))return json({ok:false,error:'invalid_update'},400);
   if(Number.isNaN(offer))return json({ok:false,error:'invalid_offer_amount'},400);
   if(status==='offer_ready'&&offer===null)return json({ok:false,error:'offer_amount_required'},400);
   const updated=await env.DB.prepare('UPDATE instant_buyout_requests SET status=?,offer_amount_cents=?,offer_notes=?,partner_vendor_name=?,partner_vendor_contact=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .bind(status,offer,notes,vendor,contact,id).run();
   if(!updated.meta?.changes)return json({ok:false,error:'request_not_found'},404);
   return json({ok:true});
  }
  return json({ok:false,error:'unknown_action'},400);
 }catch(error){console.error('Instant Buyout save failed',error);return json({ok:false,error:'instant_buyout_unavailable'},500);}
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
