import { ensureMarketplaceBoostSchema, currentMarketplaceAccount } from "../_lib/marketplace-boost.js";
const CATEGORIES = ['Singles','Sealed','Graded cards','Collections','Accessories','Clothing','Plushies','Other'];

function json(body,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
  });
}
function clean(value,max=100){
  return String(value||'').trim().slice(0,max);
}
async function ensureInventoryListingSchema(db) {
  const columns = await db.prepare('PRAGMA table_info(vendor_inventory)').all();
  const names = new Set((columns.results || []).map(column => column.name));
  const additions = [
    ['tcgcsv_product_id', 'ALTER TABLE vendor_inventory ADD COLUMN tcgcsv_product_id INTEGER'],
    ['catalog_image_url', "ALTER TABLE vendor_inventory ADD COLUMN catalog_image_url TEXT NOT NULL DEFAULT ''"],
    ['catalog_set_name', "ALTER TABLE vendor_inventory ADD COLUMN catalog_set_name TEXT NOT NULL DEFAULT ''"],
    ['catalog_card_number', "ALTER TABLE vendor_inventory ADD COLUMN catalog_card_number TEXT NOT NULL DEFAULT ''"],
    ['catalog_product_url', "ALTER TABLE vendor_inventory ADD COLUMN catalog_product_url TEXT NOT NULL DEFAULT ''"],
    ['extra_image_keys', "ALTER TABLE vendor_inventory ADD COLUMN extra_image_keys TEXT NOT NULL DEFAULT '[]'"]
  ];
  for (const addition of additions) {
    const name = addition[0];
    const sql = addition[1];
    if (!names.has(name)) {
      try {
        await db.prepare(sql).run();
      } catch (error) {
        if (!String(error && error.message || '').toLowerCase().includes('duplicate column')) throw error;
      }
    }
  }
}
function parseImageKeys(value){try{const v=JSON.parse(String(value||'[]'));return Array.isArray(v)?v.filter(x=>typeof x==='string'):[];}catch{return [];}}
function normalizeCategory(value){
  const key=String(value||'').trim().toLowerCase();
  const aliases={'single':'Singles','singles':'Singles','sealed':'Sealed','slab':'Graded cards','slabs':'Graded cards','graded':'Graded cards','graded cards':'Graded cards','collection':'Collections','collections':'Collections','accessories':'Accessories','clothing':'Clothing','plushies':'Plushies','other':'Other'};
  return aliases[key]||'';
}

export async function onRequestGet({request,env}){
  if(!env.DB)return json({ok:false,error:'database_not_configured'},503);
  await ensureMarketplaceBoostSchema(env);
  const viewer=await currentMarketplaceAccount(request,env).catch(()=>null);
  const url=new URL(request.url);
  const search=clean(url.searchParams.get('q'),100);
  const requestedCategory=clean(url.searchParams.get('category'),40);
  const category=requestedCategory?normalizeCategory(requestedCategory):'';
  if(requestedCategory&&!category)return json({ok:false,error:'invalid_category',message:'Choose a valid marketplace category.'},400);
  const limit=Math.max(1,Math.min(100,Number.parseInt(url.searchParams.get('limit')||'60',10)||60));
  const pattern='%'+search+'%';
  try{
    const result=await env.DB.prepare(`
      SELECT
        i.id AS listing_id,
        i.account_id,
        i.item_name,
        i.category,
        i.quantity_hint,
        i.notes,
        i.price_cents,
        i.condition_label,
        i.image_key,
        i.tcgcsv_product_id,
        i.catalog_image_url,
        i.catalog_set_name,
        i.catalog_card_number,
        i.catalog_product_url,
        i.extra_image_keys,
        i.created_at,
        i.updated_at,
        b.boosted_until,
        p.shop_name,
        p.logo_key AS shop_logo_key,
        p.cover_key AS shop_cover_key,
        cp.username,
        (SELECT e.event_name FROM vendor_events e
          WHERE e.id=i.event_id AND e.account_id=i.account_id LIMIT 1) AS event_name
      FROM vendor_inventory i
      JOIN vendor_profiles p ON p.account_id=i.account_id
      JOIN collector_profiles cp ON cp.account_id=i.account_id
      JOIN accounts a ON a.id=i.account_id
      LEFT JOIN (SELECT listing_id, MAX(ends_at) AS boosted_until FROM marketplace_listing_boosts WHERE ends_at > CURRENT_TIMESTAMP GROUP BY listing_id) b ON b.listing_id=i.id
      WHERE i.is_for_sale=1
        AND i.listing_status='active'
        AND TRIM(COALESCE(p.shop_name,''))<>''
        AND cp.is_public=1
        AND (?='' OR LOWER(i.category)=LOWER(?))
        AND (?='' OR i.item_name LIKE ? OR i.notes LIKE ? OR p.shop_name LIKE ? OR cp.username LIKE ?)
      ORDER BY CASE WHEN b.boosted_until IS NOT NULL THEN 1 ELSE 0 END DESC, COALESCE(i.updated_at,i.created_at) DESC, i.id DESC
      LIMIT ?
    `).bind(
      category,category,
      search,pattern,pattern,pattern,pattern,
      limit
    ).all();
    const listings=(result.results||[]).map(item=>({
      ...item,
      boosted:Boolean(item.boosted_until),
      is_owner:Boolean(viewer&&Number(item.account_id)===viewer.id),
      image_url:item.image_key?'/api/vendor/image?key='+encodeURIComponent(item.image_key):String(item.catalog_image_url||''),
      image_urls:(()=>{const custom=item.image_key?'/api/vendor/image?key='+encodeURIComponent(item.image_key):'';const extra=parseImageKeys(item.extra_image_keys).map(key=>'/api/vendor/image?key='+encodeURIComponent(key));const urls=[];for(const value of [custom||String(item.catalog_image_url||''),String(item.catalog_image_url||''),...extra])if(value&&!urls.includes(value))urls.push(value);return urls;})(),
      shop_url:'/collector.html?user='+encodeURIComponent(item.username)+'#shop',
      profile_url:'/collector.html?user='+encodeURIComponent(item.username)
    }));
    return json({ok:true,listings,count:listings.length,filters:{q:search,category}});
  }catch(error){
    console.error('Marketplace listings query failed',error);
    return json({ok:false,error:'marketplace_unavailable',message:'Marketplace listings are temporarily unavailable.'},503);
  }
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
