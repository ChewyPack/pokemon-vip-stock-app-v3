import { sendWebPush } from '../_lib/web-push.js';

const COOKIE = 'collector_session';
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
function getCookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const value = part.trim();
    if (value.startsWith(name + '=')) return value.slice(name.length + 1);
  }
  return '';
}
function b64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
async function sha256(value) {
  return b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
async function currentAccount(request, env) {
  const token = getCookie(request, COOKIE);
  if (!token) return null;
  const account = await env.DB.prepare(
    'SELECT id, session_expires_at FROM accounts WHERE session_token_hash = ? LIMIT 1'
  ).bind(await sha256(token)).first();
  if (!account || !account.session_expires_at || Number(account.session_expires_at) <= Date.now()) return null;
  return account;
}
function allowedPushEndpoint(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (
      host === 'fcm.googleapis.com' ||
      host === 'updates.push.services.mozilla.com' ||
      host === 'push.services.mozilla.com' ||
      host.endsWith('.push.services.mozilla.com') ||
      host === 'web.push.apple.com' ||
      host.endsWith('.notify.windows.com') ||
      host === 'push.opera.com'
    );
  } catch (_) { return false; }
}
function safeArray(value, max = 30) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(v => String(v).trim()).filter(Boolean))].slice(0, max);
}
async function ensurePreferences(db, accountId) {
  await db.prepare('INSERT OR IGNORE INTO notification_preferences (account_id) VALUES (?)').bind(accountId).run();
  return db.prepare('SELECT * FROM notification_preferences WHERE account_id = ?').bind(accountId).first();
}
async function getState(db, accountId) {
  const prefs = await ensurePreferences(db, accountId);
  const notifications = await db.prepare(
    'SELECT id, notification_type, title, body, url, data_json, read_at, created_at FROM notifications WHERE account_id = ? ORDER BY id DESC LIMIT 100'
  ).bind(accountId).all();
  const unread = await db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE account_id = ? AND read_at IS NULL').bind(accountId).first();
  return {
    ok: true,
    unread: Number(unread?.count || 0),
    notifications: notifications.results || [],
    preferences: {
      in_app_enabled: Number(prefs.in_app_enabled) === 1,
      browser_push_enabled: Number(prefs.browser_push_enabled) === 1,
      states: safeParse(prefs.states_json),
      retailers: safeParse(prefs.retailers_json),
      stock_alerts_enabled: Number(prefs.stock_alerts_enabled) === 1,
      line_alerts_enabled: Number(prefs.line_alerts_enabled) === 1
    },
    vapid_public_key: ''
  };
}
function safeParse(value) {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}
export async function onRequestGet({ request, env }) {
  try {
    const account = await currentAccount(request, env);
    if (!account) return json({ ok: false, error: 'unauthorized' }, 401);
    const result = await getState(env.DB, account.id);
    result.vapid_public_key = env.VAPID_PUBLIC_KEY || '';
    return json(result);
  } catch (error) {
    console.error('Notification inbox read failed:', error);
    return json({ ok: false, error: 'notification_read_failed' }, 500);
  }
}
export async function onRequestPost({ request, env }) {
  try {
    const account = await currentAccount(request, env);
    if (!account) return json({ ok: false, error: 'unauthorized' }, 401);
    const data = await request.json().catch(() => null);
    if (!data || typeof data !== 'object') return json({ ok: false, error: 'bad_request' }, 400);
    const db = env.DB;
    await ensurePreferences(db, account.id);

    if (data.action === 'subscribe') {
      const sub = data.subscription;
      if (!sub || typeof sub.endpoint !== 'string' || !allowedPushEndpoint(sub.endpoint) ||
          !sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string') {
        return json({ ok: false, error: 'invalid_subscription' }, 422);
      }
      if (sub.endpoint.length > 2048 || sub.keys.p256dh.length > 256 || sub.keys.auth.length > 256) {
        return json({ ok: false, error: 'invalid_subscription' }, 422);
      }
      await db.prepare(`
        INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth, user_agent, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(endpoint) DO UPDATE SET
          account_id = excluded.account_id, p256dh = excluded.p256dh, auth = excluded.auth,
          user_agent = excluded.user_agent, updated_at = CURRENT_TIMESTAMP
      `).bind(account.id, sub.endpoint, sub.keys.p256dh, sub.keys.auth, String(request.headers.get('user-agent') || '').slice(0, 300)).run();
      await db.prepare('UPDATE notification_preferences SET browser_push_enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE account_id = ?').bind(account.id).run();
      return json({ ok: true, ...(await getState(db, account.id)) });
    }

    if (data.action === 'unsubscribe') {
      if (typeof data.endpoint === 'string') {
        await db.prepare('DELETE FROM push_subscriptions WHERE account_id = ? AND endpoint = ?').bind(account.id, data.endpoint).run();
      } else {
        await db.prepare('DELETE FROM push_subscriptions WHERE account_id = ?').bind(account.id).run();
      }
      await db.prepare('UPDATE notification_preferences SET browser_push_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE account_id = ?').bind(account.id).run();
      return json({ ok: true, ...(await getState(db, account.id)) });
    }

    if (data.action === 'preferences') {
      const states = safeArray(data.states, 60);
      const retailers = safeArray(data.retailers, 30);
      await db.prepare(`
        UPDATE notification_preferences SET
          in_app_enabled = ?, states_json = ?, retailers_json = ?,
          stock_alerts_enabled = ?, line_alerts_enabled = ?, updated_at = CURRENT_TIMESTAMP
        WHERE account_id = ?
      `).bind(
        data.in_app_enabled === false ? 0 : 1,
        JSON.stringify(states), JSON.stringify(retailers),
        data.stock_alerts_enabled === false ? 0 : 1,
        data.line_alerts_enabled === false ? 0 : 1,
        account.id
      ).run();
      return json({ ok: true, ...(await getState(db, account.id)) });
    }
    return json({ ok: false, error: 'unsupported_action' }, 400);
  } catch (error) {
    console.error('Notification subscription update failed:', error);
    return json({ ok: false, error: 'notification_update_failed' }, 500);
  }
}
export async function onRequestPatch({ request, env }) {
  try {
    const account = await currentAccount(request, env);
    if (!account) return json({ ok: false, error: 'unauthorized' }, 401);
    const data = await request.json().catch(() => null);
    if (!data) return json({ ok: false, error: 'bad_request' }, 400);
    if (data.action === 'read' && Number.isInteger(Number(data.id))) {
      await env.DB.prepare('UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND account_id = ?').bind(Number(data.id), account.id).run();
    } else if (data.action === 'read_all') {
      await env.DB.prepare('UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE account_id = ? AND read_at IS NULL').bind(account.id).run();
    } else {
      return json({ ok: false, error: 'unsupported_action' }, 400);
    }
    return json(await getState(env.DB, account.id));
  } catch (error) {
    console.error('Notification read-state update failed:', error);
    return json({ ok: false, error: 'notification_update_failed' }, 500);
  }
}
export async function onRequestDelete({ request, env }) {
  try {
    const account = await currentAccount(request, env);
    if (!account) return json({ ok: false, error: 'unauthorized' }, 401);
    const data = await request.json().catch(() => ({}));
    if (data.id) {
      await env.DB.prepare('DELETE FROM notifications WHERE id = ? AND account_id = ?').bind(Number(data.id), account.id).run();
    } else {
      await env.DB.prepare('DELETE FROM notifications WHERE account_id = ?').bind(account.id).run();
    }
    return json(await getState(env.DB, account.id));
  } catch (error) {
    console.error('Notification deletion failed:', error);
    return json({ ok: false, error: 'notification_delete_failed' }, 500);
  }
}
