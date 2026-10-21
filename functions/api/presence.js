import { currentChatAccount } from "../_lib/chat.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function isChatPage(page) {
  return page === "/chat.html" || page === "/community.html" || page.startsWith("/community/");
}

export async function onRequestPost({ request, env }) {
  try {
    const account = await currentChatAccount(request, env);
    if (!account) return json({ ok: false, error: "login_required" }, 401);
    const data = await request.json().catch(() => ({}));
    const rawPage = String(data?.page || "/").slice(0, 200);
    const page = rawPage.startsWith("/") && !rawPage.startsWith("//") ? rawPage.split("?")[0].split("#")[0] : "/";
    const inChat = isChatPage(page) ? 1 : 0;
    const lastSeen = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO site_presence (account_id, last_seen_at, current_page, in_chat)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        current_page = excluded.current_page,
        in_chat = excluded.in_chat
    `).bind(account.id, lastSeen, page, inChat).run();
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
      SELECT a.id, a.display_name, p.username, s.last_seen_at, s.current_page, s.in_chat
      FROM accounts a
      LEFT JOIN collector_profiles p ON p.account_id = a.id
      LEFT JOIN site_presence s ON s.account_id = a.id
      WHERE datetime(s.last_seen_at) >= datetime('now', '-24 hours')
      ORDER BY s.last_seen_at DESC
      LIMIT 500
    `).all();
    const now = Date.now();
    const collectors = results.map(row => {
      const seenMs = row.last_seen_at ? Date.parse(row.last_seen_at) : 0;
      const online = Number.isFinite(seenMs) && now - seenMs <= 120000 && now >= seenMs - 30000;
      return {
        id: Number(row.id),
        display_name: row.display_name || "Collector",
        username: row.username || "",
        last_seen_at: row.last_seen_at || null,
        current_page: row.current_page || "",
        online,
        in_chat: online && Number(row.in_chat || 0) === 1
      };
    });
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
