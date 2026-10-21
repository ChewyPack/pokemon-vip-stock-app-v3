import { currentChatAccount, publishChatEvent } from "../_lib/chat.js";
import { sendWebPush } from "../_lib/web-push.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function cookie(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const item = part.trim();
    if (item.startsWith(name + "=")) return item.slice(name.length + 1);
  }
  return "";
}
function b64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function sha256(value) {
  return b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
async function admin(request, env) {
  const account = await currentChatAccount(request, env);
  return account && account.is_admin ? account : null;
}
function normalizeTier(value) {
  return String(value || "").trim().toLowerCase().replace(/[_-]/g, " ");
}
function isActiveMember(row) {
  const status = String(row.membership_status || "").toLowerCase();
  const tier = normalizeTier(row.membership_entitlement_tier || row.membership_tier);
  return ["active", "trialing"].includes(status) && !["", "free", "none", "inactive"].includes(tier);
}
async function pushToAccount(env, accountId, title, body, url) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
  const prefs = await env.DB.prepare("SELECT browser_push_enabled FROM notification_preferences WHERE account_id = ?").bind(accountId).first();
  if (Number(prefs?.browser_push_enabled || 0) !== 1) return;
  const { results = [] } = await env.DB.prepare("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE account_id = ?").bind(accountId).all();
  await Promise.all(results.map(async sub => {
    try {
      const response = await sendWebPush(sub, { title, body, url, tag: "mention-" + accountId }, env);
      if (response.status === 404 || response.status === 410) {
        await env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(sub.id).run();
      }
    } catch (error) { console.error("Admin mention push failed:", error); }
  }));
}
async function notifyMention(env, accountId, sender, message, channelName) {
  const title = "You were mentioned in community chat";
  const body = (sender.display_name || "PokePrizePool Admin") + " mentioned you in " + channelName + ": " + message.slice(0, 180);
  const prefs = await env.DB.prepare("SELECT in_app_enabled FROM notification_preferences WHERE account_id = ?").bind(accountId).first().catch(() => null);
  if (Number(prefs?.in_app_enabled ?? 1) === 1) {
    await env.DB.prepare("INSERT INTO notifications (account_id, notification_type, title, body, url, data_json) VALUES (?, 'mention', ?, ?, ?, ?)")
      .bind(accountId, title, body, "/community.html", JSON.stringify({ kind: "chat_mention", channel: channelName })).run();
  }
  await pushToAccount(env, accountId, title, body, "/community.html");
}
export async function onRequestGet({ request, env }) {
  try {
    if (!(await admin(request, env))) return json({ ok: false, error: "admin_required" }, 403);
    const url = new URL(request.url);
    const mode = url.searchParams.get("view") || "members";
    if (mode === "alerts") {
      const result = await env.DB.prepare(`
        SELECT r.*, h.report_id AS hidden_report_id
        FROM reports r
        LEFT JOIN admin_hidden_reports h ON h.report_id = r.id
        WHERE h.report_id IS NULL
        ORDER BY datetime(r.created_at) DESC LIMIT 500
      `).all();
      const alerts = (result.results || []).filter(row => {
        const stillThere = String(row.still_there || "").trim().toLowerCase();
        return !row.still_there || ["yes", "true", "in stock"].includes(stillThere);
      }).slice(0, 250).map(row => ({
        id: row.id,
        store: row.store || "Store",
        location: row.location || [row.store_town, row.store_address].filter(Boolean).join(" — "),
        product: row.product || "",
        product_name: row.product_name || row.product || "",
        state: row.state || "",
        quantity: row.quantity_text || row.quantity || "",
        created_at: row.created_at || ""
      }));
      return json({ ok: true, alerts });
    }
    const result = await env.DB.prepare(`
      SELECT a.id, a.display_name, a.email, a.created_at, a.is_admin,
        a.membership_tier, a.membership_entitlement_tier, a.membership_status,
        a.membership_current_period_end, a.membership_cancel_at_period_end,
        p.username
      FROM accounts a LEFT JOIN collector_profiles p ON p.account_id = a.id
      ORDER BY a.created_at DESC LIMIT 1000
    `).all();
    const members = (result.results || []).map(row => ({
      id: Number(row.id), display_name: row.display_name || "Collector",
      email: row.email || "", username: row.username || "",
      created_at: row.created_at || "", is_admin: Number(row.is_admin || 0) === 1,
      membership_tier: row.membership_entitlement_tier || row.membership_tier || "free",
      membership_status: row.membership_status || "inactive",
      current_period_end: row.membership_current_period_end || null,
      cancel_at_period_end: Number(row.membership_cancel_at_period_end || 0) === 1,
      active: isActiveMember(row)
    }));
    return json({ ok: true, members, count: members.length });
  } catch (error) {
    console.error("Admin tools read failed:", error);
    return json({ ok: false, error: "admin_tools_read_failed" }, 500);
  }
}
export async function onRequestDelete({ request, env }) {
  try {
    const sender = await admin(request, env);
    if (!sender) return json({ ok: false, error: "admin_required" }, 403);
    const data = await request.json().catch(() => null);
    const reportId = Number(data?.report_id);
    if (!Number.isSafeInteger(reportId) || reportId < 1) return json({ ok: false, error: "invalid_report_id" }, 400);
    await env.DB.prepare("INSERT OR IGNORE INTO admin_hidden_reports (report_id, hidden_by_account_id, reason) VALUES (?, ?, ?)")
      .bind(reportId, sender.id, String(data?.reason || "").slice(0, 300) || null).run();
    return json({ ok: true, hidden: true, report_id: reportId });
  } catch (error) {
    console.error("Admin alert hide failed:", error);
    return json({ ok: false, error: "admin_alert_hide_failed", detail: String(error?.message || "").slice(0, 180) }, 500);
  }
}
export async function onRequestPost({ request, env }) {
  try {
    const sender = await admin(request, env);
    if (!sender) return json({ ok: false, error: "admin_required" }, 403);
    const data = await request.json().catch(() => null);
    if (!data || typeof data !== "object") return json({ ok: false, error: "bad_request" }, 400);
    const text = String(data.message || "").trim().slice(0, 900);
    if (!text) return json({ ok: false, error: "message_required" }, 400);
    const targetType = String(data.target_type || "");
    const target = String(data.target || "").trim();
    const channel = await env.DB.prepare("SELECT id, name FROM chat_channels WHERE is_active = 1 AND slug = ? LIMIT 1")
      .bind(String(data.channel || "general")).first();
    if (!channel) return json({ ok: false, error: "chat_channel_not_found" }, 404);

    const { results: allAccounts = [] } = await env.DB.prepare(`
      SELECT a.id, a.display_name, a.membership_tier, a.membership_entitlement_tier,
        a.membership_status, p.username
      FROM accounts a LEFT JOIN collector_profiles p ON p.account_id = a.id
    `).all();
    let recipients = [];
    let mentionLabel = "";
    if (targetType === "username") {
      const wanted = target.replace(/^@/, "").toLowerCase();
      recipients = allAccounts.filter(a => String(a.username || "").toLowerCase() === wanted);
      if (!recipients.length) return json({ ok: false, error: "username_not_found" }, 404);
      mentionLabel = "@" + (recipients[0].username || target);
    } else if (targetType === "group") {
      const group = target.toLowerCase();
      if (group === "everyone") recipients = allAccounts;
      else if (group === "collector+" || group === "collector_plus" || group === "collector plus") recipients = allAccounts.filter(a => isActiveMember(a) && ["collector+", "collector plus"].includes(normalizeTier(a.membership_entitlement_tier || a.membership_tier)));
      else if (group === "vendor" || group === "vendor+") recipients = allAccounts.filter(a => isActiveMember(a) && normalizeTier(a.membership_entitlement_tier || a.membership_tier) === "vendor");
      else if (group === "organizer" || group === "organizer+") recipients = allAccounts.filter(a => isActiveMember(a) && ["organizer", "event organizer"].includes(normalizeTier(a.membership_entitlement_tier || a.membership_tier)));
      else if (group === "active members") recipients = allAccounts.filter(isActiveMember);
      else if (group === "free") recipients = allAccounts.filter(a => !isActiveMember(a));
      else return json({ ok: false, error: "unknown_group" }, 400);
      mentionLabel = group === "everyone" ? "@Everyone" : group === "collector+" || group === "collector_plus" || group === "collector plus" ? "@Collector+" : group === "vendor" || group === "vendor+" ? "@Vendor+" : group === "organizer" || group === "organizer+" ? "@Organizer+" : group === "active members" ? "@Active Members" : "@Free Members";
    } else {
      return json({ ok: false, error: "invalid_target_type" }, 400);
    }
    recipients = recipients.filter(a => Number(a.id) !== Number(sender.id));
    const body = (mentionLabel + " " + text).slice(0, 1200);
    const inserted = await env.DB.prepare("INSERT INTO chat_messages (channel_id, account_id, body) VALUES (?, ?, ?)")
      .bind(Number(channel.id), sender.id, body).run();
    const messageId = Number(inserted.meta?.last_row_id);
    const saved = await env.DB.prepare("SELECT m.id, m.channel_id, m.account_id, a.display_name, p.username, m.body, m.created_at FROM chat_messages m JOIN accounts a ON a.id=m.account_id LEFT JOIN collector_profiles p ON p.account_id=a.id WHERE m.id=?")
      .bind(messageId).first();
    let realtime = true;
    try { await publishChatEvent(env, { type: "message", message: { id: Number(saved.id), channel_id: Number(saved.channel_id), account_id: Number(saved.account_id), display_name: saved.display_name || "PokePrizePool Admin", username: saved.username || "", avatar_url: "", body: saved.body, created_at: saved.created_at, edited_at: null, deleted: false } }); }
    catch (error) { realtime = false; console.error("Admin chat message saved but live broadcast failed:", error); }
    let notified = 0;
    for (const recipient of recipients) {
      try {
        await notifyMention(env, Number(recipient.id), sender, text, channel.name);
        notified++;
      } catch (error) { console.error("Admin mention notification failed for account", recipient.id, error); }
    }
    return json({ ok: true, message_id: messageId, recipients: recipients.length, notified, realtime, channel: channel.name }, 201);
  } catch (error) {
    console.error("Admin chat announcement failed:", error);
    return json({ ok: false, error: "admin_announcement_failed", detail: String(error?.message || "").slice(0, 180) }, 500);
  }
}
export async function onRequest() { return json({ ok: false, error: "method_not_allowed" }, 405); }
