const COOKIE='collector_session';
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function cookie(request,name){for(const part of (request.headers.get('Cookie')||'').split(';')){const p=part.trim();if(p.startsWith(name+'='))return p.slice(name.length+1);}return '';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sha256(value){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
async function currentAccount(request,env){const token=cookie(request,COOKIE);if(!token)return null;const account=await env.DB.prepare('SELECT id,session_expires_at FROM accounts WHERE session_token_hash=? LIMIT 1').bind(await sha256(token)).first();return account&&account.session_expires_at&&Number(account.session_expires_at)>Date.now()?account:null;}
export async function onRequestGet({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 const account=await currentAccount(request,env);if(!account)return json({ok:false,error:'login_required'},401);
 try{const result=await env.DB.prepare('SELECT id,list_type,product_type,product_name,set_name,card_number,condition,quantity,notes,image_url,estimated_value_cents,created_at FROM collector_items WHERE account_id=? ORDER BY created_at DESC LIMIT 500').bind(account.id).all();return json({ok:true,items:result.results||[]});}
 catch(error){console.error('Collector items read failed:',error);return json({ok:false,error:'items_read_failed'},500);}
}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 const account=await currentAccount(request,env);if(!account)return json({ok:false,error:'login_required'},401);
 let data;try{data=await request.json();}catch{return json({ok:false,error:'bad_request'},400);}
 const listType=['collection','wishlist'].includes(data.list_type)?data.list_type:'collection';
 const productType=['card','sealed','graded'].includes(data.product_type)?data.product_type:'card';
 const name=typeof data.product_name==='string'?data.product_name.trim():'';
 const setName=typeof data.set_name==='string'?data.set_name.trim():'';
 const number=typeof data.card_number==='string'?data.card_number.trim():'';
 const condition=typeof data.condition==='string'?data.condition.trim():'';
 const notes=typeof data.notes==='string'?data.notes.trim():'';
 const image=typeof data.image_url==='string'?data.image_url.trim():'';
 const quantity=Number(data.quantity||1);
 const value=data.estimated_value===undefined||data.estimated_value===null||data.estimated_value===''?null:Number(data.estimated_value);
 if(!name||name.length>160||setName.length>120||number.length>40||condition.length>60||notes.length>500)return json({ok:false,error:'invalid_item'},400);
 if(!Number.isInteger(quantity)||quantity<1||quantity>9999)return json({ok:false,error:'invalid_quantity'},400);
 if(image.length>500||(image&&!/^https:\/\//i.test(image)))return json({ok:false,error:'invalid_image_url'},400);
 if(value!==null&&(!Number.isFinite(value)||value<0||value>100000000))return json({ok:false,error:'invalid_estimated_value'},400);
 try{
  const result=await env.DB.prepare('INSERT INTO collector_items(account_id,list_type,product_type,product_name,set_name,card_number,condition,quantity,notes,image_url,estimated_value_cents) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(account.id,listType,productType,name,setName,number,condition,quantity,notes,image, value===null?null:Math.round(value*100)).run();
  return json({ok:true,id:result.meta?.last_row_id||null},201);
 }catch(error){console.error('Collector item save failed:',error);return json({ok:false,error:'item_save_failed'},500);}
}
export async function onRequestDelete({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 const account=await currentAccount(request,env);if(!account)return json({ok:false,error:'login_required'},401);
 const id=Number(new URL(request.url).searchParams.get('id'));
 if(!Number.isInteger(id)||id<1)return json({ok:false,error:'invalid_item_id'},400);
 try{const result=await env.DB.prepare('DELETE FROM collector_items WHERE id=? AND account_id=?').bind(id,account.id).run();if(!result.meta?.changes)return json({ok:false,error:'item_not_found'},404);return json({ok:true});}
 catch(error){console.error('Collector item delete failed:',error);return json({ok:false,error:'item_delete_failed'},500);}
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
