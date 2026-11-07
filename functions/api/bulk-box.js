const COOKIE='collector_session';
const TIERS=new Set([0,25,50,75,100,200,300,400,500]);
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function clean(v,max=160){return String(v??'').trim().slice(0,max);}
function cookie(request){for(const p of (request.headers.get('Cookie')||'').split(';')){const s=p.trim();if(s.startsWith(COOKIE+'='))return s.slice(COOKIE.length+1);}return '';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function account(request,env){const token=cookie(request);if(!token)return null;const hash=b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)));const a=await env.DB.prepare('SELECT id,session_expires_at FROM accounts WHERE session_token_hash=? LIMIT 1').bind(hash).first();return a&&Number(a.session_expires_at)>Date.now()?a:null;}
function normalizeRow(d){const name=clean(d.item_name||d.card_name||d.name,160),set=clean(d.set_name||d.set,120),number=clean(d.card_number||d.number,50),condition=clean(d.condition_label||d.condition||'Near Mint',60),quantity=Number(d.quantity??1),price=Number(d.price_cents??Math.round(Number(d.price||0)*100));if(!name)throw new Error('Each card needs a name.');if(!Number.isInteger(quantity)||quantity<1||quantity>9999)throw new Error('Quantity must be between 1 and 9,999.');if(!TIERS.has(price))throw new Error('Choose one of the supported Bulk Box price tiers.');return {name,set,number,condition,quantity,price,productId:Number(d.tcgcsv_product_id)||null,image:clean(d.image_url,1000)};}
export async function onRequestGet({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},503);
 const u=new URL(request.url),q=clean(u.searchParams.get('q'),80),tier=u.searchParams.get('tier')||'',limit=Math.max(1,Math.min(100,Number(u.searchParams.get('limit')||60)));
 if(tier!==''&&!TIERS.has(Number(tier)))return json({ok:false,error:'invalid_price_tier'},400);
 try{
  const rows=await env.DB.prepare(`SELECT b.id,b.account_id,b.tcgcsv_product_id,b.item_name,b.set_name,b.card_number,b.image_url,b.condition_label,b.quantity,b.price_cents,cp.username,vp.shop_name
   FROM bulk_box_items b JOIN collector_profiles cp ON cp.account_id=b.account_id
   LEFT JOIN vendor_profiles vp ON vp.account_id=b.account_id
   WHERE b.is_published=1 AND b.quantity>0 AND cp.is_public=1
   AND (?='' OR b.item_name LIKE ? OR b.set_name LIKE ? OR b.card_number LIKE ? OR cp.username LIKE ?)
   AND (?='' OR b.price_cents=?) ORDER BY b.price_cents,b.item_name COLLATE NOCASE LIMIT ?`)
   .bind(q,'%'+q+'%','%'+q+'%','%'+q+'%','%'+q+'%',tier,tier===''?null:Number(tier),limit).all();
  const a=await account(request,env);
  let mine=[];
  if(a){const own=await env.DB.prepare('SELECT id,tcgcsv_product_id,item_name,set_name,card_number,image_url,condition_label,quantity,price_cents,is_published,show_in_shop,show_in_ripz FROM bulk_box_items WHERE account_id=? ORDER BY updated_at DESC,id DESC').bind(a.id).all();mine=own.results||[];}
  return json({ok:true,items:rows.results||[],mine,count:(rows.results||[]).length,authenticated:!!a});
 }catch(e){console.error('Bulk Box load failed',e);return json({ok:false,error:'bulk_box_unavailable'},503);}
}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},503);
 const a=await account(request,env);if(!a)return json({ok:false,error:'login_required'},401);
 let d;try{d=await request.json();}catch{return json({ok:false,error:'invalid_json'},400);}
 const action=clean(d.action,20);
 try{
  if(action==='delete'){const id=Number(d.id);if(!Number.isSafeInteger(id)||id<1)return json({ok:false,error:'invalid_id'},400);const r=await env.DB.prepare('DELETE FROM bulk_box_items WHERE id=? AND account_id=?').bind(id,a.id).run();if(!r.meta?.changes)return json({ok:false,error:'item_not_found'},404);}
  else if(action==='save'){
   const row=normalizeRow(d),published=d.is_published===false?0:1,shop=d.show_in_shop?1:0,ripz=d.show_in_ripz?1:0,id=Number(d.id)||0;
   if(row.productId){const p=await env.DB.prepare('SELECT p.name,p.image_url,g.name AS set_name,p.card_number FROM tcgcsv_products p LEFT JOIN tcgcsv_groups g ON g.group_id=p.group_id WHERE p.product_id=? AND p.category_id=3 LIMIT 1').bind(row.productId).first();if(!p)return json({ok:false,error:'catalog_product_not_found'},400);row.name=clean(p.name);row.set=clean(p.set_name);row.number=clean(p.card_number);row.image=clean(p.image_url,1000);}
   if(id){const r=await env.DB.prepare('UPDATE bulk_box_items SET tcgcsv_product_id=?,item_name=?,set_name=?,card_number=?,image_url=?,condition_label=?,quantity=?,price_cents=?,is_published=?,show_in_shop=?,show_in_ripz=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND account_id=?').bind(row.productId,row.name,row.set,row.number,row.image,row.condition,row.quantity,row.price,published,shop,ripz,id,a.id).run();if(!r.meta?.changes)return json({ok:false,error:'item_not_found'},404);}
   else await env.DB.prepare('INSERT INTO bulk_box_items(account_id,tcgcsv_product_id,item_name,set_name,card_number,image_url,condition_label,quantity,price_cents,is_published,show_in_shop,show_in_ripz) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(a.id,row.productId,row.name,row.set,row.number,row.image,row.condition,row.quantity,row.price,published,shop,ripz).run();
  }else if(action==='import'){
   if(!Array.isArray(d.items)||!d.items.length||d.items.length>200)return json({ok:false,error:'import_limit',message:'Import between 1 and 200 rows at a time.'},400);
   const statements=[];
   for(const raw of d.items){const r=normalizeRow(raw);statements.push(env.DB.prepare('INSERT INTO bulk_box_items(account_id,item_name,set_name,card_number,image_url,condition_label,quantity,price_cents,is_published) VALUES(?,?,?,?,?,?,?,?,1)').bind(a.id,r.name,r.set,r.number,r.image,r.condition,r.quantity,r.price));}
   await env.DB.batch(statements);
  }else return json({ok:false,error:'invalid_action'},400);
  const own=await env.DB.prepare('SELECT id,tcgcsv_product_id,item_name,set_name,card_number,image_url,condition_label,quantity,price_cents,is_published,show_in_shop,show_in_ripz FROM bulk_box_items WHERE account_id=? ORDER BY updated_at DESC,id DESC').bind(a.id).all();
  return json({ok:true,mine:own.results||[]});
 }catch(e){console.error('Bulk Box write failed',e);return json({ok:false,error:'bulk_box_save_failed',message:e.message||'Could not save bulk inventory.'},400);}
}
