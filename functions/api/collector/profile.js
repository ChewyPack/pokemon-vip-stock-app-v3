import { COLLECTOR_BUDDY_POKEMON, ensureCollectorRewardSchema, getCollectorAchievements } from "../../_lib/collector-rewards.js";
const COOKIE='collector_session';
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function cookie(request,name){for(const part of (request.headers.get('Cookie')||'').split(';')){const p=part.trim();if(p.startsWith(name+'='))return p.slice(name.length+1);}return '';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sha256(value){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
async function currentAccount(request,env){
 const token=cookie(request,COOKIE);if(!token)return null;
 const account=await env.DB.prepare('SELECT id,display_name,email,session_expires_at FROM accounts WHERE session_token_hash=? LIMIT 1').bind(await sha256(token)).first();
 if(!account||!account.session_expires_at||Number(account.session_expires_at)<=Date.now())return null;
 return account;
}
function safeUsername(value){return typeof value==='string'&&/^[a-zA-Z0-9_]{3,24}$/.test(value);}
export async function onRequestGet({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 const url=new URL(request.url),requested=(url.searchParams.get('username')||'').trim();
 try{
  await ensureCollectorRewardSchema(env);
  if(requested){
   const profile=await env.DB.prepare(`SELECT p.account_id,p.username,p.bio,p.avatar_url,p.cover_url,p.buddy_pokemon,p.featured_pokemon,p.favorite_set,p.is_public,p.created_at,a.display_name FROM collector_profiles p JOIN accounts a ON a.id=p.account_id WHERE p.username=? COLLATE NOCASE LIMIT 1`).bind(requested).first();
   if(!profile||Number(profile.is_public)!==1)return json({ok:false,error:'profile_not_found'},404);
   const stats=await env.DB.prepare(`SELECT COUNT(*) AS total_items,COALESCE(SUM(quantity),0) AS total_quantity,COALESCE(SUM(CASE WHEN list_type='collection' THEN COALESCE(estimated_value_cents,0)*quantity ELSE 0 END),0) AS estimated_value_cents,COALESCE(SUM(CASE WHEN list_type='collection' AND product_type='sealed' THEN quantity ELSE 0 END),0) AS sealed_quantity,COALESCE(SUM(CASE WHEN list_type='collection' AND product_type='graded' THEN quantity ELSE 0 END),0) AS graded_quantity FROM collector_items WHERE account_id=(SELECT account_id FROM collector_profiles WHERE username=? COLLATE NOCASE) AND list_type='collection'`).bind(requested).first();
   let items;try{items=await env.DB.prepare(`SELECT i.id,i.list_type,i.product_type,i.product_name,i.set_name,i.card_number,i.condition,i.quantity,i.notes,i.image_url,i.estimated_value_cents,i.created_at,c.tcgcsv_product_id,pr.market_price AS tcgcsv_market_price,pr.subtype_name AS tcgcsv_market_price_subtype,pr.last_seen_sync AS tcgcsv_price_updated_at FROM collector_items i LEFT JOIN collector_item_catalog c ON c.item_id=i.id LEFT JOIN tcgcsv_prices pr ON pr.product_id=c.tcgcsv_product_id AND pr.subtype_name=(SELECT p2.subtype_name FROM tcgcsv_prices p2 WHERE p2.product_id=c.tcgcsv_product_id AND p2.market_price IS NOT NULL ORDER BY CASE WHEN lower(p2.subtype_name)='normal' THEN 0 WHEN lower(p2.subtype_name)='holofoil' THEN 1 ELSE 2 END LIMIT 1) WHERE i.account_id=(SELECT account_id FROM collector_profiles WHERE username=? COLLATE NOCASE) ORDER BY i.created_at DESC LIMIT 500`).bind(requested).all();}catch(queryError){const detail=String(queryError&&queryError.message||'').toLowerCase();if(!detail.includes('no such table')&&!detail.includes('no such column'))throw queryError;items=await env.DB.prepare(`SELECT id,list_type,product_type,product_name,set_name,card_number,condition,quantity,notes,image_url,estimated_value_cents,created_at FROM collector_items WHERE account_id=(SELECT account_id FROM collector_profiles WHERE username=? COLLATE NOCASE) ORDER BY created_at DESC LIMIT 500`).bind(requested).all();}
   const rewards=await getCollectorAchievements(env,Number(profile.account_id));
   const buddy=COLLECTOR_BUDDY_POKEMON.find(item=>item.key===(profile.buddy_pokemon||'pikachu'))||COLLECTOR_BUDDY_POKEMON[0];
   return json({ok:true,profile:{username:profile.username,display_name:profile.display_name,bio:profile.bio,avatar_url:profile.avatar_url,cover_url:profile.cover_url||'',buddy_pokemon:buddy.key,featured_pokemon:profile.featured_pokemon||'',favorite_set:profile.favorite_set||'',buddy_name:buddy.name,buddy_image_url:'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/'+buddy.id+'.png',achievements:rewards.badges,achievement_progress:{earned_count:rewards.earned_count,total_badges:rewards.total_badges,collection_items:rewards.collection_items},basic_achievements:rewards.basic_achievements,basic_achievement_progress:{earned_count:rewards.basic_earned_count,total_basics:rewards.total_basics},created_at:profile.created_at},buddy_options:rewards.buddy_options,stats:stats||{},items:items.results||[]});
  }
  const account=await currentAccount(request,env);if(!account)return json({ok:false,error:'login_required'},401);
  let profile=await env.DB.prepare('SELECT username,bio,avatar_url,cover_url,buddy_pokemon,featured_pokemon,favorite_set,chat_name_color,is_public,created_at FROM collector_profiles WHERE account_id=? LIMIT 1').bind(account.id).first();
  if(!profile){
   const base=String(account.display_name||'collector').toLowerCase().replace(/[^a-z0-9_]/g,'').slice(0,18)||'collector';
   let username=base;
   const existing=await env.DB.prepare('SELECT id FROM collector_profiles WHERE username=? COLLATE NOCASE LIMIT 1').bind(username).first();
   if(existing)username=(base.slice(0,18)+String(account.id).replace(/[^0-9]/g,'')).slice(0,24);
   await env.DB.prepare("INSERT INTO collector_profiles (account_id,username,bio,avatar_url,cover_url,is_public) VALUES (?,?, '', '', '', 1)").bind(account.id,username).run();
   profile=await env.DB.prepare('SELECT username,bio,avatar_url,cover_url,buddy_pokemon,featured_pokemon,favorite_set,chat_name_color,is_public,created_at FROM collector_profiles WHERE account_id=? LIMIT 1').bind(account.id).first();
  }
  let items;try{items=await env.DB.prepare(`SELECT i.id,i.list_type,i.product_type,i.product_name,i.set_name,i.card_number,i.condition,i.quantity,i.notes,i.image_url,i.estimated_value_cents,i.created_at,c.tcgcsv_product_id,pr.market_price AS tcgcsv_market_price,pr.subtype_name AS tcgcsv_market_price_subtype,pr.last_seen_sync AS tcgcsv_price_updated_at FROM collector_items i LEFT JOIN collector_item_catalog c ON c.item_id=i.id LEFT JOIN tcgcsv_prices pr ON pr.product_id=c.tcgcsv_product_id AND pr.subtype_name=(SELECT p2.subtype_name FROM tcgcsv_prices p2 WHERE p2.product_id=c.tcgcsv_product_id AND p2.market_price IS NOT NULL ORDER BY CASE WHEN lower(p2.subtype_name)='normal' THEN 0 WHEN lower(p2.subtype_name)='holofoil' THEN 1 ELSE 2 END LIMIT 1) WHERE i.account_id=? ORDER BY i.created_at DESC LIMIT 500`).bind(account.id).all();}catch(queryError){const detail=String(queryError&&queryError.message||'').toLowerCase();if(!detail.includes('no such table')&&!detail.includes('no such column'))throw queryError;items=await env.DB.prepare('SELECT id,list_type,product_type,product_name,set_name,card_number,condition,quantity,notes,image_url,estimated_value_cents,created_at FROM collector_items WHERE account_id=? ORDER BY created_at DESC LIMIT 500').bind(account.id).all();}
  const rewards=await getCollectorAchievements(env,account.id);
  const buddy=COLLECTOR_BUDDY_POKEMON.find(item=>item.key===(profile?.buddy_pokemon||'pikachu'))||COLLECTOR_BUDDY_POKEMON[0];
  return json({ok:true,account:{display_name:account.display_name},profile:profile?{...profile,buddy_pokemon:buddy.key,buddy_name:buddy.name,buddy_image_url:'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/'+buddy.id+'.png',achievements:rewards.badges,achievement_progress:{earned_count:rewards.earned_count,total_badges:rewards.total_badges,collection_items:rewards.collection_items},basic_achievements:rewards.basic_achievements,basic_achievement_progress:{earned_count:rewards.basic_earned_count,total_basics:rewards.total_basics}}:null,buddy_options:rewards.buddy_options,items:items.results||[]});
 }catch(error){console.error('Collector profile read failed:',error);return json({ok:false,error:'collector_profile_read_failed'},500);}
}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 const account=await currentAccount(request,env);if(!account)return json({ok:false,error:'login_required'},401);
 let data;try{data=await request.json();}catch{return json({ok:false,error:'bad_request'},400);}
 await ensureCollectorRewardSchema(env);
 const existingProfile=await env.DB.prepare('SELECT username,buddy_pokemon,featured_pokemon,favorite_set,chat_name_color FROM collector_profiles WHERE account_id=? LIMIT 1').bind(account.id).first().catch(()=>null);
 const submittedUsername=typeof data.username==='string'?data.username.trim():'';
 const derived=String(account.display_name||'collector').toLowerCase().replace(/[^a-z0-9_]/g,'').slice(0,18)||'collector';
 const username=submittedUsername||existingProfile?.username||derived;
 const bio=typeof data.bio==='string'?data.bio.trim():'';
 const avatar=typeof data.avatar_url==='string'?data.avatar_url.trim():'';
 const cover=typeof data.cover_url==='string'?data.cover_url.trim():'';
 const buddyPokemon=typeof data.buddy_pokemon==='string'?data.buddy_pokemon.trim():(existingProfile?.buddy_pokemon||'pikachu');
 const featuredPokemon=typeof data.featured_pokemon==='string'?data.featured_pokemon.trim():(existingProfile?.featured_pokemon||'');
 const favoriteSet=typeof data.favorite_set==='string'?data.favorite_set.trim():(existingProfile?.favorite_set||'');
 const buddy=COLLECTOR_BUDDY_POKEMON.find(item=>item.key===buddyPokemon);
 const featured=featuredPokemon?COLLECTOR_BUDDY_POKEMON.find(item=>item.key===featuredPokemon):null;
 const chatNameColor=existingProfile?.chat_name_color||'#ffd54a';
 const isPublic=data.is_public===false?0:1;
 if(!safeUsername(username))return json({ok:false,error:'invalid_username'},400);
 if(!buddy)return json({ok:false,error:'invalid_buddy_pokemon'},400);
 if(featuredPokemon&&!featured)return json({ok:false,error:'invalid_featured_pokemon'},400);
 if(favoriteSet.length>80)return json({ok:false,error:'favorite_set_too_long'},400);
 if(bio.length>500)return json({ok:false,error:'bio_too_long'},400);
 const validImage=(value,maxDataLength)=>!value||(/^https:\/\//i.test(value)&&value.length<=1000)||((value.startsWith('data:image/webp;base64,')||value.startsWith('data:image/jpeg;base64,'))&&value.length<=maxDataLength);
 if(!validImage(avatar,350000))return json({ok:false,error:'invalid_avatar_url'},400);
 if(!validImage(cover,850000))return json({ok:false,error:'invalid_cover_url'},400);
 try{
  const result=await env.DB.prepare(`INSERT INTO collector_profiles (account_id,username,bio,avatar_url,cover_url,buddy_pokemon,featured_pokemon,favorite_set,chat_name_color,is_public,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(account_id) DO UPDATE SET username=excluded.username,bio=excluded.bio,avatar_url=excluded.avatar_url,cover_url=excluded.cover_url,buddy_pokemon=excluded.buddy_pokemon,featured_pokemon=excluded.featured_pokemon,favorite_set=excluded.favorite_set,chat_name_color=excluded.chat_name_color,is_public=excluded.is_public,updated_at=CURRENT_TIMESTAMP`).bind(account.id,username,bio,avatar,cover,buddy.key,featuredPokemon,favoriteSet,chatNameColor,isPublic).run();
  return json({ok:true,profile:{username,bio,avatar_url:avatar,cover_url:cover,buddy_pokemon:buddy.key,featured_pokemon:featured?.key||'',featured_pokemon_name:featured?.name||'',featured_pokemon_image_url:featured?'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/'+featured.id+'.png':'',favorite_set:favoriteSet,buddy_name:buddy.name,buddy_image_url:'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/'+buddy.id+'.png',is_public:isPublic}},200);
 }catch(error){
  if(String(error&&error.message||'').toLowerCase().includes('unique'))return json({ok:false,error:'username_taken'},409);
  console.error('Collector profile save failed:',error);return json({ok:false,error:'profile_save_failed'},500);
 }
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
