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
  'Photo links:',row.photo_urls||'Not provided','',
  'Review this request in PokePrizePool Admin: https://pokeprizepool.com/admin.html'
 ].join('\n');
 let response;
 try{
  response=await fetch('https://api.resend.com/emails',{
   method:'POST',
   headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},
   body:JSON.stringify({
    from,to:['pokeprizepool@gmail.com'],subject,text:summary,
    html:'<h2>New Instant Buyout request #'+row.id+'</h2><p><strong>Submitted by:</strong> '+escapeHtml(row.seller_name)+' &lt;'+escapeHtml(row.seller_email)+'&gt;</p><p><strong>Category:</strong> '+escapeHtml(row.category)+'<br><strong>Title:</strong> '+escapeHtml(row.title)+'<br><strong>Quantity:</strong> '+escapeHtml(row.quantity||'Not specified')+'<br><strong>Asking price:</strong> '+escapeHtml(row.asking_price_cents==null?'Not provided':'$'+(Number(row.asking_price_cents)/100).toFixed(2))+'</p><h3>Details</h3><pre style="font:14px/1.5 Arial,sans-serif;white-space:pre-wrap">'+escapeHtml(row.details)+'</pre><h3>Condition / grading notes</h3><p>'+escapeHtml(row.condition_notes||'Not provided')+'</p><h3>Photo links</h3><pre style="font:14px/1.5 Arial,sans-serif;white-space:pre-wrap">'+escapeHtml(row.photo_urls||'Not provided')+'</pre><p><a href="https://pokeprizepool.com/admin.html">Review in PokePrizePool Admin</a></p>'
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
 const a=await env.DB.prepare('SELECT id,display_name,email,is_admin,session_expires_at FROM accounts WHERE session_token_hash=? LIMIT 1').bind(await sha256(token)).first();
 return a&&a.session_expires_at&&Number(a.session_expires_at)>Date.now()?a:null;
}
function shape(row,admin){
 const out={id:row.id,category:row.category,title:row.title,details:row.details,quantity:row.quantity,condition_notes:row.condition_notes,photo_urls:row.photo_urls,asking_price_cents:row.asking_price_cents,status:row.status,offer_amount_cents:row.offer_amount_cents,offer_notes:row.offer_notes,partner_vendor_name:row.partner_vendor_name,created_at:row.created_at,updated_at:row.updated_at};
 if(admin){out.seller_name=row.display_name||'Collector';out.seller_email=row.email||'';out.partner_vendor_contact=row.partner_vendor_contact||'';}
 return out;
}
export async function onRequestGet({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 try{
  const account=await currentAccount(request,env);if(!account)return json({ok:false,error:'login_required'},401);
  const admin=Number(account.is_admin)===1;
  const sql=admin
   ? 'SELECT r.*,a.display_name,a.email FROM instant_buyout_requests r JOIN accounts a ON a.id=r.account_id ORDER BY r.created_at DESC LIMIT 200'
   : 'SELECT * FROM instant_buyout_requests WHERE account_id=? ORDER BY created_at DESC LIMIT 100';
  const result=admin?await env.DB.prepare(sql).all():await env.DB.prepare(sql).bind(account.id).all();
  let vendorCommerce=[];
  if(admin){
   const vendors=await env.DB.prepare("SELECT a.id,a.display_name,a.email,COALESCE(v.ticket_sales_approved,0) AS ticket_sales_approved,COALESCE(v.booth_sales_approved,0) AS booth_sales_approved,COALESCE(v.review_notes,'') AS review_notes FROM accounts a LEFT JOIN vendor_commerce_approvals v ON v.account_id=a.id WHERE a.membership_status='active' AND (a.membership_entitlement_tier='vendor' OR a.membership_tier='vendor') ORDER BY a.display_name COLLATE NOCASE").all();
   vendorCommerce=(vendors.results||[]);
  }
  return json({ok:true,is_admin:admin,requests:(result.results||[]).map(row=>shape(row,admin)),vendor_commerce:vendorCommerce});
 }catch(error){console.error('Instant Buyout load failed',error);return json({ok:false,error:'instant_buyout_unavailable'},500);}
}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 try{
  const account=await currentAccount(request,env);if(!account)return json({ok:false,error:'login_required'},401);
  let d;try{d=await request.json();}catch{return json({ok:false,error:'bad_request'},400);}
  const action=clean(d.action,40);
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
