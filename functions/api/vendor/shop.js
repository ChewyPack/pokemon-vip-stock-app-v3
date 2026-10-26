function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
async function ensureDiscountSchema(db){const columns=await db.prepare('PRAGMA table_info(vendor_inventory)').all();const names=new Set((columns.results||[]).map(c=>c.name));for(const [name,sql] of [['discount_percent',"ALTER TABLE vendor_inventory ADD COLUMN discount_percent INTEGER NOT NULL DEFAULT 0"],['discount_label',"ALTER TABLE vendor_inventory ADD COLUMN discount_label TEXT NOT NULL DEFAULT ''"],['discount_ends_at',"ALTER TABLE vendor_inventory ADD COLUMN discount_ends_at TEXT NOT NULL DEFAULT ''"]]){if(!names.has(name)){try{await db.prepare(sql).run();}catch(error){if(!String(error&&error.message||'').toLowerCase().includes('duplicate column'))throw error;}}}}
export async function onRequestGet({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 const username=(new URL(request.url).searchParams.get('user')||'').trim();
 if(!/^[a-zA-Z0-9_]{3,24}$/.test(username))return json({ok:false,error:'invalid_username'},400);
 try{
  await ensureDiscountSchema(env.DB);
  const shop=await env.DB.prepare(`SELECT p.account_id,p.shop_name,p.logo_key,p.cover_key,p.bio,p.website_url,p.social_links,cp.username,cp.is_public
   FROM vendor_profiles p
   JOIN collector_profiles cp ON cp.account_id=p.account_id
   JOIN accounts a ON a.id=p.account_id
   WHERE cp.username=? COLLATE NOCASE LIMIT 1`).bind(username).first();
  if(!shop||Number(shop.is_public)!==1)return json({ok:true,shop:null,items:[]});
  const result=await env.DB.prepare(`SELECT id,item_name,category,quantity_hint,price_cents,condition_label,image_key,notes,event_id,discount_percent,discount_label,discount_ends_at,created_at
   FROM vendor_inventory
   WHERE account_id=? AND is_for_sale=1 AND listing_status='active'
   ORDER BY created_at DESC LIMIT 200`).bind(shop.account_id).all();
  const today=new Date().toISOString().slice(0,10);const items=(result.results||[]).map(i=>{const active=Number(i.discount_percent||0)>0&&i.price_cents!=null&&(!i.discount_ends_at||String(i.discount_ends_at)>=today);return {...i,discount_active:active,discounted_price_cents:active?Math.round(Number(i.price_cents)*(100-Number(i.discount_percent))/100):i.price_cents,image_url:i.image_key?'/api/vendor/image?key='+encodeURIComponent(i.image_key):''};});
  return json({ok:true,shop:{shop_name:shop.shop_name,logo_key:shop.logo_key,cover_key:shop.cover_key,bio:shop.bio,website_url:shop.website_url,social_links:shop.social_links,username:shop.username},items});
 }catch(error){console.error('Public shop load failed',error);return json({ok:false,error:'shop_unavailable'},500);}
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
