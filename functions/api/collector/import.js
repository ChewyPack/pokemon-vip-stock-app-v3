const COOKIE='collector_session';
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function cookie(request,name){for(const part of (request.headers.get('Cookie')||'').split(';')){const p=part.trim();if(p.startsWith(name+'='))return p.slice(name.length+1);}return '';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sha256(value){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
async function currentAccount(request,env){const token=cookie(request,COOKIE);if(!token)return null;const account=await env.DB.prepare('SELECT id,session_expires_at FROM accounts WHERE session_token_hash=? LIMIT 1').bind(await sha256(token)).first();return account&&account.session_expires_at&&Number(account.session_expires_at)>Date.now()?account:null;}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 const account=await currentAccount(request,env);if(!account)return json({ok:false,error:'login_required'},401);
 let data;try{data=await request.json();}catch{return json({ok:false,error:'bad_request'},400);}
 if(!Array.isArray(data.items)||data.items.length<1||data.items.length>200)return json({ok:false,error:'invalid_import_count'},400);
 const statements=[];
 for(const item of data.items){
  const listType=['collection','wishlist'].includes(item.list_type)?item.list_type:'collection';
  const productType=['card','sealed','graded'].includes(item.product_type)?item.product_type:'card';
  const name=typeof item.product_name==='string'?item.product_name.trim():'';
  const setName=typeof item.set_name==='string'?item.set_name.trim():'';
  const number=typeof item.card_number==='string'?item.card_number.trim():'';
  const condition=typeof item.condition==='string'?item.condition.trim():'';
  const notes=typeof item.notes==='string'?item.notes.trim():'';
  const quantity=Number(item.quantity||1);
  const value=item.estimated_value===undefined||item.estimated_value===null||item.estimated_value===''?null:Number(item.estimated_value);
  if(!name||name.length>160||setName.length>120||number.length>40||condition.length>60||notes.length>500||!Number.isInteger(quantity)||quantity<1||quantity>9999||(value!==null&&(!Number.isFinite(value)||value<0||value>100000000)))return json({ok:false,error:'invalid_import_row'},400);
  statements.push(env.DB.prepare('INSERT INTO collector_items(account_id,list_type,product_type,product_name,set_name,card_number,condition,quantity,notes,estimated_value_cents) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(account.id,listType,productType,name,setName,number,condition,quantity,notes,value===null?null:Math.round(value*100)));
 }
 try{await env.DB.batch(statements);return json({ok:true,imported:statements.length},201);}
 catch(error){console.error('Collector CSV import failed:',error);return json({ok:false,error:'import_failed'},500);}
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
