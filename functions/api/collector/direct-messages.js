import { notifyCollector } from '../../_lib/collector-notifications.js';

const COOKIE = 'collector_session';
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
}
function cookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const item = part.trim();
    if (item.startsWith(name + '=')) return item.slice(name.length + 1);
  }
  return '';
}
function b64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
async function sha256(value) { return b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); }
async function currentAccount(request, env) {
  const token = cookie(request, COOKIE);
  if (!token) return null;
  const account = await env.DB.prepare('SELECT id, session_expires_at FROM accounts WHERE session_token_hash = ? LIMIT 1').bind(await sha256(token)).first();
  return account && account.session_expires_at && Number(account.session_expires_at) > Date.now() ? account : null;
}
let directMessagesTableReady = null;
async function ensureTable(db) {
  if (!directMessagesTableReady) {
    directMessagesTableReady = (async () => {
      await db.prepare(`CREATE TABLE IF NOT EXISTS collector_direct_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        recipient_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 2000),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        read_at TEXT
      )`).run();
      await db.prepare('CREATE INDEX IF NOT EXISTS idx_collector_direct_messages_conversation ON collector_direct_messages(sender_account_id, recipient_account_id, id DESC)').run();
      await db.prepare('CREATE INDEX IF NOT EXISTS idx_collector_direct_messages_recipient_unread ON collector_direct_messages(recipient_account_id, read_at, id DESC)').run();
    })().catch(error => { directMessagesTableReady = null; throw error; });
  }
  await directMessagesTableReady;
}
async function profileByUsername(env, username) {
  return env.DB.prepare(`SELECT p.account_id,p.username,p.avatar_url,p.is_public,a.display_name
    FROM collector_profiles p JOIN accounts a ON a.id=p.account_id
    WHERE p.username=? COLLATE NOCASE LIMIT 1`).bind(username).first();
}
async function blocked(db, firstId, secondId) {
  return db.prepare(`SELECT 1 AS blocked FROM collector_blocks
    WHERE (blocker_account_id=? AND blocked_account_id=?)
       OR (blocker_account_id=? AND blocked_account_id=?) LIMIT 1`)
    .bind(firstId,secondId,secondId,firstId).first();
}
async function ensureAllowedTarget(env, viewerId, username) {
  const target = await profileByUsername(env, username);
  if (!target || Number(target.is_public) !== 1) return {error:json({ok:false,error:'profile_not_found'},404)};
  if (Number(target.account_id) === Number(viewerId)) return {error:json({ok:false,error:'cannot_message_self'},400)};
  if (await blocked(env.DB, viewerId, Number(target.account_id))) return {error:json({ok:false,error:'messages_unavailable'},403)};
  return {target};
}
function messageRow(row, viewerId) {
  return {
    id:Number(row.id), body:row.body, created_at:row.created_at, read_at:row.read_at || null,
    sender_account_id:Number(row.sender_account_id), recipient_account_id:Number(row.recipient_account_id),
    sender_username:row.sender_username, sender_name:row.sender_name || row.sender_username,
    sender_avatar:row.sender_avatar || '', recipient_username:row.recipient_username,
    is_own:Number(row.sender_account_id) === Number(viewerId)
  };
}
export async function onRequestGet({request,env}) {
  if (!env.DB) return json({ok:false,error:'database_not_configured'},500);
  const account = await currentAccount(request,env).catch(()=>null);
  if (!account) return json({ok:false,error:'login_required'},401);
  const url = new URL(request.url);
  const username = (url.searchParams.get('username') || '').trim().slice(0,24);
  try {
    await ensureTable(env.DB);
    if (username) {
      const found = await ensureAllowedTarget(env,account.id,username);
      if (found.error) return found.error;
      const target = found.target;
      await env.DB.prepare(`UPDATE collector_direct_messages SET read_at=CURRENT_TIMESTAMP
        WHERE sender_account_id=? AND recipient_account_id=? AND read_at IS NULL`).bind(target.account_id,account.id).run();
      // Opening a conversation also clears its corresponding in-site DM notifications.
      await env.DB.prepare(`UPDATE notifications SET read_at=CURRENT_TIMESTAMP
        WHERE account_id=? AND notification_type='direct_message'
        AND json_extract(data_json,'$.from')=? AND read_at IS NULL`).bind(account.id,target.username).run().catch(()=>{});
      const result = await env.DB.prepare(`SELECT m.id,m.sender_account_id,m.recipient_account_id,m.body,m.created_at,m.read_at,
        sp.username AS sender_username,sa.display_name AS sender_name,sp.avatar_url AS sender_avatar,rp.username AS recipient_username
        FROM collector_direct_messages m
        JOIN collector_profiles sp ON sp.account_id=m.sender_account_id
        JOIN accounts sa ON sa.id=m.sender_account_id
        JOIN collector_profiles rp ON rp.account_id=m.recipient_account_id
        WHERE (m.sender_account_id=? AND m.recipient_account_id=?) OR (m.sender_account_id=? AND m.recipient_account_id=?)
        ORDER BY m.id ASC LIMIT 300`).bind(account.id,target.account_id,target.account_id,account.id).all();
      return json({ok:true,target:{username:target.username,display_name:target.display_name||target.username,avatar_url:target.avatar_url||''},
        messages:(result.results||[]).map(row=>messageRow(row,account.id))});
    }

    const result = await env.DB.prepare(`SELECT m.id,m.sender_account_id,m.recipient_account_id,m.body,m.created_at,m.read_at,
      sp.username AS sender_username,sa.display_name AS sender_name,sp.avatar_url AS sender_avatar,
      rp.username AS recipient_username,ra.display_name AS recipient_name,rp.avatar_url AS recipient_avatar
      FROM collector_direct_messages m
      JOIN collector_profiles sp ON sp.account_id=m.sender_account_id JOIN accounts sa ON sa.id=m.sender_account_id
      JOIN collector_profiles rp ON rp.account_id=m.recipient_account_id JOIN accounts ra ON ra.id=m.recipient_account_id
      WHERE m.sender_account_id=? OR m.recipient_account_id=? ORDER BY m.id DESC LIMIT 300`).bind(account.id,account.id).all();
    const conversations = new Map();
    for (const row of result.results || []) {
      const outgoing = Number(row.sender_account_id) === Number(account.id);
      const usernameOther = outgoing ? row.recipient_username : row.sender_username;
      if (conversations.has(usernameOther)) {
        if (!outgoing && !row.read_at) conversations.get(usernameOther).unread_count += 1;
        continue;
      }
      conversations.set(usernameOther,{
        username:usernameOther,
        display_name:outgoing ? (row.recipient_name || usernameOther) : (row.sender_name || usernameOther),
        avatar_url:outgoing ? (row.recipient_avatar || '') : (row.sender_avatar || ''),
        last_message:row.body,last_at:row.created_at,
        unread_count:(!outgoing && !row.read_at)?1:0
      });
    }
    // Count every unread message per conversation, not just the newest one.
    const conversationsArray = await Promise.all([...conversations.values()].map(async item=>{
      const other=await profileByUsername(env,item.username);
      if(other) {
        const unread=await env.DB.prepare('SELECT COUNT(*) AS count FROM collector_direct_messages WHERE sender_account_id=? AND recipient_account_id=? AND read_at IS NULL')
          .bind(other.account_id,account.id).first();
        item.unread_count=Number(unread?.count||0);
      }
      return item;
    }));
    conversationsArray.sort((a,b)=>String(b.last_at).localeCompare(String(a.last_at)));
    return json({ok:true,conversations:conversationsArray});
  } catch (error) {
    console.error('Direct messages read failed:',error);
    return json({ok:false,error:'direct_messages_read_failed'},500);
  }
}
export async function onRequestPost({request,env}) {
  if (!env.DB) return json({ok:false,error:'database_not_configured'},500);
  const account=await currentAccount(request,env).catch(()=>null);
  if (!account) return json({ok:false,error:'login_required'},401);
  let data;
  try { data=await request.json(); } catch (_) { return json({ok:false,error:'invalid_json'},400); }
  const username=typeof data.username==='string'?data.username.trim().slice(0,24):'';
  const body=typeof data.body==='string'?data.body.trim():'';
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return json({ok:false,error:'invalid_username'},400);
  if (!body || body.length>2000) return json({ok:false,error:'message_required_or_too_long'},400);
  try {
    await ensureTable(env.DB);
    const found=await ensureAllowedTarget(env,account.id,username);
    if(found.error)return found.error;
    const target=found.target;
    const actor=await env.DB.prepare('SELECT p.username,a.display_name FROM collector_profiles p JOIN accounts a ON a.id=p.account_id WHERE p.account_id=? LIMIT 1').bind(account.id).first();
    if(!actor?.username) return json({ok:false,error:'sender_profile_missing'},400);
    const inserted=await env.DB.prepare('INSERT INTO collector_direct_messages(sender_account_id,recipient_account_id,body) VALUES(?,?,?)')
      .bind(account.id,target.account_id,body).run();
    const id=Number(inserted.meta?.last_row_id||0);
    const excerpt=body.length>180?body.slice(0,177)+'…':body;
    await notifyCollector(env,target.account_id,{
      type:'direct_message',title:'New message from '+(actor.display_name||actor.username),
      body:excerpt,url:'/messages.html?user='+encodeURIComponent(actor.username),
      data:{kind:'direct_message',message_id:id,from:actor.username}
    });
    return json({ok:true,id,created_at:new Date().toISOString()},201);
  } catch(error) {
    console.error('Direct message send failed:',error);
    return json({ok:false,error:'direct_message_send_failed'},500);
  }
}
export async function onRequest(){return json({ok:false,error:'method_not_allowed'},405);}
