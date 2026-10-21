import { chatJson, currentChatAccount, publishChatEvent, chatError } from "../../_lib/chat.js";
import { sendWebPush } from "../../_lib/web-push.js";

async function notifyChatMentions(env, sender, body, channelId) {
  const names = [...new Set(Array.from(body.matchAll(/(?:^|\s)@([a-zA-Z0-9_.-]{2,30})/g), match => match[1].toLowerCase()))];
  if (!names.length) return;
  const { results = [] } = await env.DB.prepare(`
    SELECT a.id, a.display_name, p.username
    FROM accounts a JOIN collector_profiles p ON p.account_id = a.id
    WHERE LOWER(p.username) IN (${names.map(() => "?").join(",")})
  `).bind(...names).all();
  for (const recipient of results) {
    if (Number(recipient.id) === Number(sender.id)) continue;
    const title = "You were mentioned in community chat";
    const excerpt = body.length > 150 ? body.slice(0, 147) + "..." : body;
    const notificationBody = (sender.display_name || "A collector") + " mentioned you: " + excerpt;
    try {
      const prefs = await env.DB.prepare("SELECT in_app_enabled, browser_push_enabled FROM notification_preferences WHERE account_id = ?").bind(recipient.id).first().catch(() => null);
      if (Number(prefs?.in_app_enabled ?? 1) === 1) {
        await env.DB.prepare("INSERT INTO notifications (account_id, notification_type, title, body, url, data_json) VALUES (?, 'mention', ?, ?, ?, ?)")
          .bind(recipient.id, title, notificationBody, "/chat.html", JSON.stringify({ kind: "chat_mention", channel_id: channelId })).run();
      }
      if (Number(prefs?.browser_push_enabled || 0) === 1 && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
        const { results: subscriptions = [] } = await env.DB.prepare("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE account_id = ?").bind(recipient.id).all();
        await Promise.all(subscriptions.map(async sub => {
          try {
            const response = await sendWebPush(sub, { title, body: notificationBody, url: "/chat.html", tag: "chat-mention-" + recipient.id }, env);
            if (response.status === 404 || response.status === 410) {
              await env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(sub.id).run();
            }
          } catch (error) { console.error("Chat mention push failed:", error); }
        }));
      }
    } catch (error) { console.error("Chat mention notification failed:", recipient.id, error); }
  }
}

function realtimeReady(env) {
  return Boolean(env.CHAT_ROOM && env.CHAT_INTERNAL_SECRET);
}

export async function onRequestGet({ request, env }) {
  try {
    const account = await currentChatAccount(request, env);
    if (!account) return chatJson({ ok: false, error: "login_required" }, 401);
    const url = new URL(request.url);
    const channelId = Number(url.searchParams.get("channel"));
    const before = Number(url.searchParams.get("before") || 0);
    if (!Number.isSafeInteger(channelId) || channelId < 1) return chatJson({ ok: false, error: "invalid_channel" }, 400);
    const channel = await env.DB.prepare("SELECT id FROM chat_channels WHERE id = ? AND is_active = 1").bind(channelId).first();
    if (!channel) return chatJson({ ok: false, error: "channel_not_found" }, 404);
    let result;
    if (Number.isSafeInteger(before) && before > 0) {
      result = await env.DB.prepare(
        "SELECT m.id, m.channel_id, m.account_id, a.display_name, p.username, p.avatar_url, m.body, m.created_at, m.edited_at, m.deleted_at FROM chat_messages m JOIN accounts a ON a.id = m.account_id LEFT JOIN collector_profiles p ON p.account_id = a.id WHERE m.channel_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT 100"
      ).bind(channelId, before).all();
    } else {
      result = await env.DB.prepare(
        "SELECT m.id, m.channel_id, m.account_id, a.display_name, p.username, p.avatar_url, m.body, m.created_at, m.edited_at, m.deleted_at FROM chat_messages m JOIN accounts a ON a.id = m.account_id LEFT JOIN collector_profiles p ON p.account_id = a.id WHERE m.channel_id = ? ORDER BY m.id DESC LIMIT 100"
      ).bind(channelId).all();
    }
    const messages = (result.results || []).reverse().map(m => ({
      id: Number(m.id), channel_id: Number(m.channel_id), account_id: Number(m.account_id),
      display_name: m.display_name || "Collector", username: m.username || "", avatar_url: m.avatar_url || "",
      body: m.deleted_at ? "" : m.body, created_at: m.created_at,
      edited_at: m.edited_at, deleted: Boolean(m.deleted_at), mine: Number(m.account_id) === account.id
    }));
    return chatJson({ ok: true, messages, realtime_ready: realtimeReady(env) });
  } catch (error) {
    return chatError(error, "chat_messages_read_failed");
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const account = await currentChatAccount(request, env);
    if (!account) return chatJson({ ok: false, error: "login_required" }, 401);
    if (!realtimeReady(env)) return chatJson({ ok: false, error: "chat_realtime_not_configured", message: "Real-time chat is not configured for this environment yet." }, 503);
    let data;
    try { data = await request.json(); } catch { return chatJson({ ok: false, error: "bad_request" }, 400); }
    const channelId = Number(data.channel_id);
    const body = typeof data.body === "string" ? data.body.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim() : "";
    if (!Number.isSafeInteger(channelId) || channelId < 1) return chatJson({ ok: false, error: "invalid_channel" }, 400);
    if (!body || body.length > 1200) return chatJson({ ok: false, error: "message_length", message: "Messages must be between 1 and 1,200 characters." }, 400);
    const channel = await env.DB.prepare("SELECT id FROM chat_channels WHERE id = ? AND is_active = 1").bind(channelId).first();
    if (!channel) return chatJson({ ok: false, error: "channel_not_found" }, 404);
    const recent = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM chat_messages WHERE account_id = ? AND created_at >= datetime('now', '-1 minute') AND deleted_at IS NULL"
    ).bind(account.id).first();
    if (Number(recent?.total || 0) >= 15) return chatJson({ ok: false, error: "rate_limited", message: "You have sent 15 messages in the last minute. Please slow down." }, 429);

    const inserted = await env.DB.prepare(
      "INSERT INTO chat_messages (channel_id, account_id, body) VALUES (?, ?, ?)"
    ).bind(channelId, account.id, body).run();
    const id = Number(inserted.meta?.last_row_id);
    const saved = await env.DB.prepare(
      "SELECT m.id, m.channel_id, m.account_id, a.display_name, p.username, p.avatar_url, m.body, m.created_at FROM chat_messages m JOIN accounts a ON a.id = m.account_id LEFT JOIN collector_profiles p ON p.account_id = a.id WHERE m.id = ?"
    ).bind(id).first();
    const message = {
      id: Number(saved.id), channel_id: Number(saved.channel_id), account_id: Number(saved.account_id),
      display_name: saved.display_name || "Collector", username: saved.username || "", avatar_url: saved.avatar_url || "",
      body: saved.body, created_at: saved.created_at, edited_at: null, deleted: false,
      mine: true
    };
    let realtime = true;
    try { await publishChatEvent(env, { type: "message", message: { ...message, mine: undefined } }); }
    catch (error) { realtime = false; console.error("Chat message saved but live broadcast failed:", error); }
    try { await notifyChatMentions(env, account, body, channelId); }
    catch (error) { console.error("Chat mention processing failed:", error); }
    return chatJson({ ok: true, message, realtime }, 201);
  } catch (error) {
    return chatError(error, "chat_message_send_failed");
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const account = await currentChatAccount(request, env);
    if (!account) return chatJson({ ok: false, error: "login_required" }, 401);
    if (!realtimeReady(env)) return chatJson({ ok: false, error: "chat_realtime_not_configured" }, 503);
    let data;
    try { data = await request.json(); } catch { return chatJson({ ok: false, error: "bad_request" }, 400); }
    const id = Number(data.id);
    if (!Number.isSafeInteger(id) || id < 1) return chatJson({ ok: false, error: "invalid_message" }, 400);
    const existing = await env.DB.prepare("SELECT id, channel_id, account_id FROM chat_messages WHERE id = ? AND deleted_at IS NULL").bind(id).first();
    if (!existing) return chatJson({ ok: false, error: "message_not_found" }, 404);
    if (Number(existing.account_id) !== account.id && !account.is_admin) return chatJson({ ok: false, error: "not_allowed" }, 403);
    await env.DB.prepare("UPDATE chat_messages SET deleted_at = CURRENT_TIMESTAMP, body = '' WHERE id = ?").bind(id).run();
    let realtime = true;
    try { await publishChatEvent(env, { type: "delete", id, channel_id: Number(existing.channel_id) }); }
    catch (error) { realtime = false; console.error("Chat delete saved but live broadcast failed:", error); }
    return chatJson({ ok: true, id, realtime });
  } catch (error) {
    return chatError(error, "chat_message_delete_failed");
  }
}

export async function onRequest() {
  return chatJson({ ok: false, error: "method_not_allowed" }, 405);
}
