// POST /api/account/cancel-membership
// Staging-only: schedules cancellation at the end of the current billing period.
const COOKIE='collector_session';
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function getCookie(request,name){for(const part of (request.headers.get('Cookie')||'').split(';')){const p=part.trim();if(p.startsWith(name+'='))return p.slice(name.length+1);}return '';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sha256(value){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:'database_not_configured'},500);
 if(typeof env.STRIPE_TEST_SECRET_KEY!=='string'||!env.STRIPE_TEST_SECRET_KEY.startsWith('sk_test_'))return json({ok:false,error:'stripe_test_key_not_configured'},503);
 const token=getCookie(request,COOKIE);if(!token)return json({ok:false,error:'login_required'},401);
 try{
  const account=await env.DB.prepare('SELECT id,session_expires_at,membership_status,stripe_subscription_id,membership_cancel_at_period_end FROM accounts WHERE session_token_hash=? LIMIT 1').bind(await sha256(token)).first();
  if(!account||!account.session_expires_at||Number(account.session_expires_at)<=Date.now())return json({ok:false,error:'login_required'},401);
  if(account.membership_status!=='active'||!account.stripe_subscription_id)return json({ok:false,error:'membership_not_active'},409);
  if(Number(account.membership_cancel_at_period_end||0)===1)return json({ok:false,error:'cancellation_already_scheduled'},409);
  const params=new URLSearchParams();params.set('cancel_at_period_end','true');
  const response=await fetch('https://api.stripe.com/v1/subscriptions/'+encodeURIComponent(account.stripe_subscription_id),{method:'POST',headers:{Authorization:'Bearer '+env.STRIPE_TEST_SECRET_KEY,'Content-Type':'application/x-www-form-urlencoded'},body:params});
  const result=await response.json();
  if(!response.ok||result.cancel_at_period_end!==true){console.error('Staging subscription cancellation request failed:',response.status,result.error?.type||'unknown');return json({ok:false,error:'stripe_cancellation_failed'},502);}
  await env.DB.prepare('UPDATE accounts SET membership_cancel_at_period_end=1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND stripe_subscription_id=?').bind(account.id,account.stripe_subscription_id).run();
  return json({ok:true,cancel_at_period_end:true,current_period_end:result.current_period_end||result.items?.data?.[0]?.current_period_end||null});
 }catch(error){console.error('Staging account cancellation failed:',error);return json({ok:false,error:'cancellation_failed'},500);}
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
