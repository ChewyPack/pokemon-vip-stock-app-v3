function json(body,status=200){
 const successful=Boolean(body?.ok)&&status===200;
 return new Response(JSON.stringify(body),{status,headers:{
  'content-type':'application/json; charset=utf-8',
  'cache-control':successful?'public, max-age=30, s-maxage=180, stale-while-revalidate=300':'no-store'
 }});
}
const ALLOWED_KINDS=new Set(['BOOSTER_BOX','ETB','BOOSTER_BUNDLE','BOOSTER_PACK','TIN','BLISTER','COLLECTION','PREMIUM_COLLECTION','BUILD_AND_BATTLE','STARTER_DECK','SLEEVED_BOOSTER']);
function inferKind(query){
 const patterns=[
  ['PREMIUM_COLLECTION',/\b(?:ultra\s+)?premium\s+collection(?:s)?\b|\bupcs?\b/i],
  ['ETB',/\belite\s+trainer\s+box(?:es)?\b|\betbs?\b/i],
  ['BOOSTER_BOX',/\bbooster\s+box(?:es)?\b|\bbb\b/i],
  ['BOOSTER_BUNDLE',/\bbooster\s+bundles?\b/i],
  ['BOOSTER_PACK',/\bbooster\s+packs?\b|\bsleeved\s+boosters?\b/i],
  ['BUILD_AND_BATTLE',/\bbuild\s*(?:&|and)\s*battle\b/i],
  ['STARTER_DECK',/\bstarter\s+decks?\b/i],
  ['BLISTER',/\bblisters?\b/i],
  ['TIN',/\btins?\b/i],
  ['COLLECTION',/\bcollection\s+box(?:es)?\b|\bcollections?\b/i]
 ];
 for(const [kind,pattern] of patterns){
  const match=String(query||'').match(pattern);
  if(match)return {kind,query:String(query).replace(pattern,' ').replace(/\s+/g,' ').replace(/^\s*pok[eé]mon(?:\s+tcg)?\b[\s:–-]*/i,'').trim()};
 }
 return {kind:'',query:String(query||'').trim()};
}
async function requestProducts(url,key){
 const response=await fetch(url.toString(),{headers:{'X-Api-Key':key,Accept:'application/json'}});
 const body=await response.json().catch(()=>({}));
 if(!response.ok){
  const code=String(body?.error?.code||body?.error||'');
  if(response.status===401||code==='INVALID_API_KEY'||code==='MISSING_API_KEY')return {error:'sealed_api_key_invalid',status:502};
  if(response.status===429||code==='QUOTA_EXCEEDED')return {error:'sealed_catalog_quota_exceeded',status:502};
  console.error('Sealed catalog upstream HTTP',response.status,code);
  return {error:'sealed_catalog_unavailable',status:502};
 }
 return {products:Array.isArray(body.data)?body.data:[],meta:body.meta||null};
}
export async function onRequestGet({request,env}){
 const key=env.POKEMON_TCG_API_KEY;
 if(!key)return json({ok:false,error:'sealed_api_key_missing'},503);
 const url=new URL(request.url),q=(url.searchParams.get('q')||'').trim();
 if(q.length>100)return json({ok:false,error:'query_too_long'},400);
 const rawKind=(url.searchParams.get('kind')||'').trim().toUpperCase();
 if(rawKind&&rawKind!=='ALL'&&!ALLOWED_KINDS.has(rawKind))return json({ok:false,error:'invalid_sealed_kind'},400);
 const allBrowse=rawKind==='ALL'&&q.length<2;
 const inferred=inferKind(q);
 let kind=rawKind&&rawKind!=='ALL'?rawKind:(!rawKind?inferred.kind:'');
 let searchQuery=q;
 if(rawKind&&rawKind!=='ALL'){
  // The selected category wins; strip any product-type words from the query,
  // even when the text previously named a different category.
  if(inferred.kind)searchQuery=inferred.query;
 }else if(!rawKind){
  kind=inferred.kind;
  searchQuery=inferred.query;
 }
 if(q.length<2&&!kind&&!allBrowse)return json({ok:true,products:[]});
 try{
  const upstream=new URL('https://api.pokemontcgapi.com/v1/sealed');
  upstream.searchParams.set('lang','en');
  upstream.searchParams.set('limit','50');
  upstream.searchParams.set('orderBy','-release_date');
  if(kind)upstream.searchParams.set('kind',kind);
  if(searchQuery.length>=2)upstream.searchParams.set('q',searchQuery);
  const result=await requestProducts(upstream,key);
  if(result.error)return json({ok:false,error:result.error},result.status);
  const products=result.products.slice(0,50).map(p=>({
   id:p.id||p.sku,sku:p.sku||p.id,name:p.name||'',kind:p.kind||'',
   set_name:p.set_name||'',set_code:p.set_code||'',image_url:p.image_url||'',
   release_date:p.release_date||'',languages:p.languages||[],pack_count:p.pack_count??null
  }));
  return json({ok:true,products,catalog_total:Number(result.meta?.total_count??products.length)});
 }catch(e){
  console.error('Sealed catalog search failed:',e);
  return json({ok:false,error:'sealed_catalog_unavailable'},502);
 }
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
