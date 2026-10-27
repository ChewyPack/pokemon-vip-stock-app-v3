const COOKIE='collector_session';
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function getCookie(request,name){for(const part of (request.headers.get('Cookie')||'').split(';')){const p=part.trim();if(p.startsWith(name+'='))return p.slice(name.length+1);}return '';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sha256(value){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
function clean(value,max=500){return String(value??'').trim().slice(0,max);}
function validUrl(value){if(!value)return true;try{return new URL(value).protocol==='https:';}catch{return false;}}
async function vendorAccount(request,env){
 const token=getCookie(request,COOKIE);if(!token)return {error:json({ok:false,error:'login_required'},401)};
 const account=await env.DB.prepare('SELECT id,session_expires_at,is_admin,membership_status,membership_tier,membership_entitlement_tier FROM accounts WHERE session_token_hash=? LIMIT 1').bind(await sha256(token)).first();
 if(!account||!account.session_expires_at||Number(account.session_expires_at)<=Date.now())return {error:json({ok:false,error:'login_required'},401)};
 return {account};
}
function hasCollectorPlus(a){const tiers=[String(a?.membership_entitlement_tier||'').toLowerCase(),String(a?.membership_tier||'').toLowerCase()];return !!a&&(Number(a.is_admin||0)===1||(String(a.membership_status||'').toLowerCase()==='active'&&tiers.some(t=>['collector_plus','collector+','vendor'].includes(t))));}
function hasVendorPlus(a){return !!a&&(Number(a.is_admin||0)===1||(String(a.membership_status||'').toLowerCase()==='active'&&(String(a.membership_entitlement_tier||'').toLowerCase()==='vendor'||String(a.membership_tier||'').toLowerCase()==='vendor')));}
async function ensureDiscountSchema(env){const columns=await env.DB.prepare('PRAGMA table_info(vendor_inventory)').all();const names=new Set((columns.results||[]).map(column=>column.name));const additions=[['discount_percent',"ALTER TABLE vendor_inventory ADD COLUMN discount_percent INTEGER NOT NULL DEFAULT 0"],['discount_label',"ALTER TABLE vendor_inventory ADD COLUMN discount_label TEXT NOT NULL DEFAULT ''"],['discount_ends_at',"ALTER TABLE vendor_inventory ADD COLUMN discount_ends_at TEXT NOT NULL DEFAULT ''"],['tcgcsv_product_id','ALTER TABLE vendor_inventory ADD COLUMN tcgcsv_product_id INTEGER'],['catalog_image_url',"ALTER TABLE vendor_inventory ADD COLUMN catalog_image_url TEXT NOT NULL DEFAULT ''"],['catalog_set_name',"ALTER TABLE vendor_inventory ADD COLUMN catalog_set_name TEXT NOT NULL DEFAULT ''"],['catalog_card_number',"ALTER TABLE vendor_inventory ADD COLUMN catalog_card_number TEXT NOT NULL DEFAULT ''"],['catalog_product_url',"ALTER TABLE vendor_inventory ADD COLUMN catalog_product_url TEXT NOT NULL DEFAULT ''"],['extra_image_keys',"ALTER TABLE vendor_inventory ADD COLUMN extra_image_keys TEXT NOT NULL DEFAULT '[]'"]];for(const [name,sql] of additions){if(!names.has(name)){try{await env.DB.prepare(sql).run();}catch(error){if(!String(error&&error.message||'').toLowerCase().includes('duplicate column'))throw error;}}}}
function parseImageKeys(value){try{const v=JSON.parse(String(value||'[]'));return Array.isArray(v)?v.filter(x=>typeof x==='string'):[];}catch{return [];}}
function listingImages(item){const custom=item.image_key?'/api/vendor/image?key='+encodeURIComponent(item.image_key):'';const catalog=String(item.catalog_image_url||'');const extra=parseImageKeys(item.extra_image_keys).map(k=>'/api/vendor/image?key='+encodeURIComponent(k));const urls=[];for(const url of [custom||catalog,catalog,...extra])if(url&&!urls.includes(url))urls.push(url);return {...item,extra_image_keys:parseImageKeys(item.extra_image_keys),image_url:urls[0]||'',image_urls:urls};}
async function getData(account,env){
 const shop=await env.DB.prepare('SELECT id,shop_name,logo_url,cover_url,logo_key,cover_key,bio,website_url,social_links,updated_at FROM vendor_profiles WHERE account_id=? LIMIT 1').bind(account.id).first();
 const events=await env.DB.prepare('SELECT id,event_name,event_date,venue_name,venue_address,booth_location,notes,created_at,updated_at FROM vendor_events WHERE account_id=? ORDER BY event_date ASC,id DESC').bind(account.id).all();
 const inventory=await env.DB.prepare('SELECT i.id,i.event_id,i.item_name,i.category,i.quantity_hint,i.notes,i.price_cents,i.condition_label,i.image_key,i.tcgcsv_product_id,i.catalog_image_url,i.catalog_set_name,i.catalog_card_number,i.catalog_product_url,i.extra_image_keys,i.is_for_sale,i.listing_status,i.discount_percent,i.discount_label,i.discount_ends_at,i.created_at,i.updated_at,e.event_name FROM vendor_inventory i LEFT JOIN vendor_events e ON e.id=i.event_id AND e.account_id=i.account_id WHERE i.account_id=? ORDER BY i.created_at DESC').bind(account.id).all();
 return json({ok:true,is_vendor_plus:hasVendorPlus(account),can_use_catalog:hasCollectorPlus(account),shop:shop||{shop_name:'',logo_url:'',cover_url:'',logo_key:'',cover_key:'',bio:'',website_url:'',social_links:''},events:events.results||[],inventory:(inventory.results||[]).map(listingImages)});
}
export async function onRequestGet({request,env}){try{const auth=await vendorAccount(request,env);if(auth.error)return auth.error;await ensureDiscountSchema(env);return await getData(auth.account,env);}catch(error){console.error('Shop manager load failed',error);return json({ok:false,error:'vendor_tools_unavailable'},500);}}
export async function onRequestPost({request,env}){
 try{
  const auth=await vendorAccount(request,env);if(auth.error)return auth.error;
  const a=auth.account,d=await request.json(),action=clean(d.action,40);await ensureDiscountSchema(env);
  if(action==='save_profile'){
   const shop_name=clean(d.shop_name,100),logo_url=clean(d.logo_url,1000),cover_url=clean(d.cover_url,1000),logo_key=clean(d.logo_key,300),cover_key=clean(d.cover_key,300),bio=clean(d.bio,1000),website_url=clean(d.website_url,1000),social_links=clean(d.social_links,1000);
   if(!shop_name)return json({ok:false,error:'shop_name_required'},400);
   if(!validUrl(logo_url)||!validUrl(cover_url)||!validUrl(website_url)||!validUrl(social_links))return json({ok:false,error:'https_urls_only'},400);
   await env.DB.prepare('INSERT INTO vendor_profiles (account_id,shop_name,logo_url,cover_url,logo_key,cover_key,bio,website_url,social_links) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET shop_name=excluded.shop_name,logo_url=excluded.logo_url,cover_url=excluded.cover_url,logo_key=excluded.logo_key,cover_key=excluded.cover_key,bio=excluded.bio,website_url=excluded.website_url,social_links=excluded.social_links,updated_at=CURRENT_TIMESTAMP').bind(a.id,shop_name,logo_url,cover_url,logo_key,cover_key,bio,website_url,social_links).run();
  }else if(action==='save_event'){
   const id=Number(d.id)||0,event_name=clean(d.event_name,120),event_date=clean(d.event_date,10),venue_name=clean(d.venue_name,160),venue_address=clean(d.venue_address,300),booth_location=clean(d.booth_location,120),notes=clean(d.notes,1000);
   if(!event_name||!/^\d{4}-\d{2}-\d{2}$/.test(event_date))return json({ok:false,error:'event_name_and_date_required'},400);
   if(id){const r=await env.DB.prepare('UPDATE vendor_events SET event_name=?,event_date=?,venue_name=?,venue_address=?,booth_location=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND account_id=?').bind(event_name,event_date,venue_name,venue_address,booth_location,notes,id,a.id).run();if(!r.meta?.changes)return json({ok:false,error:'event_not_found'},404);}
   else await env.DB.prepare('INSERT INTO vendor_events (account_id,event_name,event_date,venue_name,venue_address,booth_location,notes) VALUES (?,?,?,?,?,?,?)').bind(a.id,event_name,event_date,venue_name,venue_address,booth_location,notes).run();
  }else if(action==='delete_event'){
   const id=Number(d.id);if(!id)return json({ok:false,error:'invalid_event'},400);
   const r=await env.DB.prepare('DELETE FROM vendor_events WHERE id=? AND account_id=?').bind(id,a.id).run();if(!r.meta?.changes)return json({ok:false,error:'event_not_found'},404);
  }else if(action==='save_item'){
   const id=Number(d.id)||0,eventId=d.event_id?Number(d.event_id):null;let item_name=clean(d.item_name,160),category=clean(d.category,40)||'Singles',quantity_hint=clean(d.quantity_hint,80),notes=clean(d.notes,500),condition_label=clean(d.condition_label,80),image_key=clean(d.image_key,300),price=d.price===''||d.price==null?null:Number(d.price),is_for_sale=d.is_for_sale==='false'||d.is_for_sale===false?0:1;
   let discountPercent=d.discount_percent===''||d.discount_percent==null?0:Number(d.discount_percent),discountLabel=clean(d.discount_label,80),discountEndsAt=clean(d.discount_ends_at,10);
   let productId=Number(d.tcgcsv_product_id)||null,catalogImage='',catalogSet='',catalogNumber='',catalogProductUrl='',extraKeys=parseImageKeys(d.extra_image_keys);
   if(!item_name)return json({ok:false,error:'item_name_required'},400);
   if(!['Singles','Sealed','Graded cards','Collections','Accessories','Clothing','Plushies','Other'].includes(category))return json({ok:false,error:'invalid_category'},400);
   if(price!==null&&(!Number.isFinite(price)||price<0||price>10000000))return json({ok:false,error:'invalid_price'},400);
   const validOwnedKey=key=>{const prefix='vendors/'+a.id+'/';return String(key||'').startsWith(prefix)&&/^[a-f0-9-]+\.(jpg|png|webp|avif)$/i.test(String(key).slice(prefix.length));};
   if(image_key&&!validOwnedKey(image_key))return json({ok:false,error:'invalid_image_key'},400);
   if(extraKeys.length>4||extraKeys.some(key=>!validOwnedKey(key))||new Set(extraKeys).size!==extraKeys.length)return json({ok:false,error:'invalid_extra_image_keys'},400);
   if(!productId&&image_key&&extraKeys.length>3)return json({ok:false,error:'too_many_images'},400);
   if(productId){
    if(!Number.isSafeInteger(productId)||productId<1)return json({ok:false,error:'invalid_catalog_product'},400);
    const product=await env.DB.prepare('SELECT p.product_id,p.name,p.image_url,p.product_url,p.product_type,p.card_number,g.name AS set_name FROM tcgcsv_products p LEFT JOIN tcgcsv_groups g ON g.group_id=p.group_id WHERE p.product_id=? AND p.category_id=3 LIMIT 1').bind(productId).first();
    if(!product)return json({ok:false,error:'catalog_product_not_found'},400);
    item_name=clean(product.name,160);category=String(product.product_type||'').toLowerCase()==='sealed'?'Sealed':(category==='Graded cards'?'Graded cards':'Singles');
    catalogImage=validUrl(String(product.image_url||''))?String(product.image_url||''):'';
    catalogSet=clean(product.set_name,120);catalogNumber=clean(product.card_number,80);
    catalogProductUrl=validUrl(String(product.product_url||''))?String(product.product_url||''):'';
   }
   if(extraKeys.length>0&&!hasCollectorPlus(a)){
    const previous=id?await env.DB.prepare('SELECT extra_image_keys FROM vendor_inventory WHERE id=? AND account_id=? LIMIT 1').bind(id,a.id).first():null;
    if(JSON.stringify(parseImageKeys(previous?.extra_image_keys))!==JSON.stringify(extraKeys))return json({ok:false,error:'collector_plus_required'},403);
   }
   if(!Number.isInteger(discountPercent)||discountPercent<0||discountPercent>90)return json({ok:false,error:'invalid_discount'},400);
   if(discountEndsAt&&!/^\d{4}-\d{2}-\d{2}$/.test(discountEndsAt))return json({ok:false,error:'invalid_discount_end_date'},400);
   if(discountPercent>0&&price===null)return json({ok:false,error:'discount_requires_price'},400);
   if(!hasVendorPlus(a)){const previous=id?await env.DB.prepare('SELECT discount_percent,discount_label,discount_ends_at FROM vendor_inventory WHERE id=? AND account_id=? LIMIT 1').bind(id,a.id).first():null;if(previous){if(discountPercent!==Number(previous.discount_percent||0)||discountLabel!==String(previous.discount_label||'')||discountEndsAt!==String(previous.discount_ends_at||''))return json({ok:false,error:'vendor_plus_required'},403);discountPercent=Number(previous.discount_percent||0);discountLabel=String(previous.discount_label||'');discountEndsAt=String(previous.discount_ends_at||'');}else if(discountPercent||discountLabel||discountEndsAt)return json({ok:false,error:'vendor_plus_required'},403);}
   if(eventId){const e=await env.DB.prepare('SELECT id FROM vendor_events WHERE id=? AND account_id=?').bind(eventId,a.id).first();if(!e)return json({ok:false,error:'event_not_found'},400);}
   if(id){const r=await env.DB.prepare('UPDATE vendor_inventory SET event_id=?,item_name=?,category=?,quantity_hint=?,notes=?,price_cents=?,condition_label=?,image_key=?,tcgcsv_product_id=?,catalog_image_url=?,catalog_set_name=?,catalog_card_number=?,catalog_product_url=?,extra_image_keys=?,is_for_sale=?,listing_status=?,discount_percent=?,discount_label=?,discount_ends_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND account_id=?').bind(eventId,item_name,category,quantity_hint,notes,price===null?null:Math.round(price*100),condition_label,image_key,productId,catalogImage,catalogSet,catalogNumber,catalogProductUrl,JSON.stringify(extraKeys),is_for_sale,is_for_sale?'active':'hidden',discountPercent,discountLabel,discountEndsAt,id,a.id).run();if(!r.meta?.changes)return json({ok:false,error:'item_not_found'},404);}
   else await env.DB.prepare('INSERT INTO vendor_inventory (account_id,event_id,item_name,category,quantity_hint,notes,price_cents,condition_label,image_key,tcgcsv_product_id,catalog_image_url,catalog_set_name,catalog_card_number,catalog_product_url,extra_image_keys,is_for_sale,listing_status,discount_percent,discount_label,discount_ends_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(a.id,eventId,item_name,category,quantity_hint,notes,price===null?null:Math.round(price*100),condition_label,image_key,productId,catalogImage,catalogSet,catalogNumber,catalogProductUrl,JSON.stringify(extraKeys),is_for_sale,is_for_sale?'active':'hidden',discountPercent,discountLabel,discountEndsAt).run();
  }else if(action==='delete_item'){
   const id=Number(d.id);if(!id)return json({ok:false,error:'invalid_item'},400);
   const r=await env.DB.prepare('DELETE FROM vendor_inventory WHERE id=? AND account_id=?').bind(id,a.id).run();if(!r.meta?.changes)return json({ok:false,error:'item_not_found'},404);
  }else return json({ok:false,error:'unknown_action'},400);
  return await getData(a,env);
 }catch(error){console.error('Shop manager save failed',error);return json({ok:false,error:'vendor_tools_unavailable'},500);}
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
