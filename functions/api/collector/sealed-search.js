function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}

function normalize(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function genericKind(query){
  let value=normalize(query).replace(/^pokemon /,'').replace(/ pokemon$/,'').trim();
  const patterns=[
    [/^(etb|elite trainer box|elite trainer boxes)$/, 'ETB'],
    [/^(bb|booster box|booster boxes)$/, 'BOOSTER_BOX'],
    [/^(booster pack|booster packs|pack|packs)$/, 'BOOSTER_PACK'],
    [/^(booster bundle|booster bundles)$/, 'BOOSTER_BUNDLE'],
    [/^(upc|ultra premium collection|ultra premium collections)$/, 'PREMIUM_COLLECTION']
  ];
  for(const [pattern,kind] of patterns)if(pattern.test(value))return kind;
  return null;
}
function queryVariants(query){
  const values=[query];
  const replacements=[
    [/\betb\b/ig,'Elite Trainer Box'],
    [/\belite trainer boxes?\b/ig,'ETB'],
    [/\bupc\b/ig,'Ultra Premium Collection'],
    [/\bultra premium collections?\b/ig,'UPC'],
    [/\bbb\b/ig,'Booster Box'],
    [/\bbooster boxes?\b/ig,'BB'],
    [/\bbooster bundles?\b/ig,'Booster Bundle'],
    [/\bbooster packs?\b/ig,'Booster Pack']
  ];
  for(const [pattern,replacement] of replacements){
    if(pattern.test(query)){
      const next=query.replace(pattern,replacement).trim();
      if(next&&!values.some(value=>normalize(value)===normalize(next)))values.push(next);
    }
    if(values.length>=3)break;
  }
  return values;
}
async function requestProducts(url,key){
  const response=await fetch(url.toString(),{headers:{'X-Api-Key':key,Accept:'application/json'}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    if(response.status===401)return {error:'sealed_api_key_invalid',status:502};
    if(response.status===429)return {error:'sealed_catalog_quota_exceeded',status:502};
    console.error('Sealed catalog upstream HTTP',response.status,body?.error?.code||'');
    return {error:'sealed_catalog_unavailable',status:502};
  }
  return {products:Array.isArray(body.data)?body.data:[],meta:body.meta||null};
}
export async function onRequestGet({request,env}){
  const key=env.POKEMON_TCG_API_KEY;
  if(!key)return json({ok:false,error:'sealed_api_key_missing'},503);
  const url=new URL(request.url),q=(url.searchParams.get('q')||'').trim();
  if(q.length<2)return json({ok:true,products:[]});
  if(q.length>100)return json({ok:false,error:'query_too_long'},400);
  try{
    const base=new URL('https://api.pokemontcgapi.com/v1/sealed');
    base.searchParams.set('lang','en');base.searchParams.set('limit','50');
    const kind=genericKind(q);
    let candidates=[];
    if(kind){
      const params=new URL(base);params.searchParams.set('kind',kind);
      const result=await requestProducts(params,key);
      if(result.error)return json({ok:false,error:result.error},result.status);
      candidates=result.products;
    }else{
      const variants=queryVariants(q);
      for(const variant of variants){
        const params=new URL(base);params.searchParams.set('q',variant);
        const result=await requestProducts(params,key);
        if(result.error){
          if(!candidates.length)return json({ok:false,error:result.error},result.status);
          break;
        }
        const seen=new Set(candidates.map(p=>String(p.id||p.sku||'')));
        for(const product of result.products){
          const id=String(product.id||product.sku||'');
          if(id&&!seen.has(id)){seen.add(id);candidates.push(product);}
        }
        if(candidates.length>=50)break;
      }
    }
    return json({ok:true,products:candidates.slice(0,50).map(p=>({
      id:p.id||p.sku,sku:p.sku||p.id,name:p.name||'',kind:p.kind||'',
      set_name:p.set_name||'',image_url:p.image_url||'',
      release_date:p.release_date||'',languages:p.languages||[]
    })),catalog_total:candidates.length});
  }catch(e){
    console.error('Sealed catalog search failed:',e);
    return json({ok:false,error:'sealed_catalog_unavailable'},502);
  }
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
