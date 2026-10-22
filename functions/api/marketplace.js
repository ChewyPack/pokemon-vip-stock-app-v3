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
function normalizeCategory(value){
  const key=String(value||'').trim().toLowerCase();
  const aliases={'single':'Singles','singles':'Singles','sealed':'Sealed','slab':'Graded cards','slabs':'Graded cards','graded':'Graded cards','graded cards':'Graded cards','collection':'Collections','collections':'Collections','accessories':'Accessories','clothing':'Clothing','plushies':'Plushies','other':'Other'};
  return aliases[key]||'';
}

export async function onRequestGet({request,env}){
  if(!env.DB)return json({ok:false,error:'database_not_configured'},503);
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
        i.created_at,
        i.updated_at,
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
      WHERE i.is_for_sale=1
        AND i.listing_status='active'
        AND TRIM(COALESCE(p.shop_name,''))<>''
        AND cp.is_public=1
        AND (?='' OR LOWER(i.category)=LOWER(?))
        AND (?='' OR i.item_name LIKE ? OR i.notes LIKE ? OR p.shop_name LIKE ? OR cp.username LIKE ?)
      ORDER BY COALESCE(i.updated_at,i.created_at) DESC, i.id DESC
      LIMIT ?
    `).bind(
      category,category,
      search,pattern,pattern,pattern,pattern,
      limit
    ).all();
    const listings=(result.results||[]).map(item=>({
      ...item,
      image_url:item.image_key?'/api/vendor/image?key='+encodeURIComponent(item.image_key):'',
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
