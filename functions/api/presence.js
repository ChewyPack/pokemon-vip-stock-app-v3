import { currentChatAccount } from "../_lib/chat.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function isChatPage(page) {
  const normalized = String(page || "/").toLowerCase().replace(/\/+$/, "") || "/";
  return normalized === "/chat" ||
    normalized === "/chat.html" ||
    normalized === "/community" ||
    normalized === "/community.html" ||
    normalized.startsWith("/community/") ||
    normalized.startsWith("/chat/");
}

export async function onRequestPost({ request, env }) {
  try {
    const account = await currentChatAccount(request, env);
    if (!account) return json({ ok: false, error: "login_required" }, 401);
    const data = await request.json().catch(() => ({}));
    const rawPage = String(data?.page || "/").slice(0, 200);
    const page = rawPage.startsWith("/") && !rawPage.startsWith("//") ? rawPage.split("?")[0].split("#")[0] : "/";
    const tabId = String(data?.tab_id || "").slice(0, 100);
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(tabId)) return json({ ok: false, error: "invalid_tab_id" }, 400);
    const inChat = isChatPage(page) ? 1 : 0;
    const lastSeen = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO site_presence_tabs (tab_id, account_id, last_seen_at, current_page, in_chat)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(tab_id) DO UPDATE SET
        account_id = excluded.account_id,
        last_seen_at = excluded.last_seen_at,
        current_page = excluded.current_page,
        in_chat = excluded.in_chat
    `).bind(tabId, account.id, lastSeen, page, inChat).run();
    return json({ ok: true, last_seen_at: lastSeen });
  } catch (error) {
    console.error("Presence heartbeat failed:", error);
    return json({ ok: false, error: "presence_update_failed" }, 500);
  }
}

export async function onRequestGet({ request, env }) {
  try {
    const account = await currentChatAccount(request, env);
    if (!account || !account.is_admin) return json({ ok: false, error: "admin_required" }, 403);
    const { results = [] } = await env.DB.prepare(`
      SELECT a.id, a.display_name, p.username, s.last_seen_at, s.current_page, s.in_chat, s.tab_id
      FROM accounts a
      LEFT JOIN collector_profiles p ON p.account_id = a.id
      LEFT JOIN site_presence_tabs s ON s.account_id = a.id
        AND datetime(s.last_seen_at) >= datetime('now', '-24 hours')
      ORDER BY s.last_seen_at DESC
      LIMIT 2000
    `).all();
    const now = Date.now();
    const byAccount = new Map();
    for (const row of results) {
      const id = Number(row.id);
      let collector = byAccount.get(id);
      if (!collector) {
        collector = {
          id,
          display_name: row.display_name || "Collector",
          username: row.username || "",
          last_seen_at: null,
          current_page: "",
          online: false,
          in_chat: false
        };
        byAccount.set(id, collector);
      }
      if (!row.last_seen_at) continue;
      const seenMs = Date.parse(row.last_seen_at);
      if (!Number.isFinite(seenMs)) continue;
      if (!collector.last_seen_at || seenMs > Date.parse(collector.last_seen_at)) {
        collector.last_seen_at = row.last_seen_at;
        collector.current_page = row.current_page || "";
      }
      const tabOnline = now - seenMs <= 120000 && now >= seenMs - 30000;
      if (tabOnline) {
        collector.online = true;
        if (Number(row.in_chat || 0) === 1) collector.in_chat = true;
      }
    }
    const collectors = Array.from(byAccount.values());
    return json({
      ok: true,
      online_count: collectors.filter(row => row.online).length,
      in_chat_count: collectors.filter(row => row.in_chat).length,
      collectors
    });
  } catch (error) {
    console.error("Presence read failed:", error);
    return json({ ok: false, error: "presence_read_failed", detail: String(error?.message || "").slice(0, 160) }, 500);
  }
}

export async function onRequest() {
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
