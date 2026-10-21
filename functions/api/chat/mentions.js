import { chatJson, currentChatAccount, chatError } from "../../_lib/chat.js";

export async function onRequestGet({ request, env }) {
  try {
    const account = await currentChatAccount(request, env);
    if (!account) return chatJson({ ok: false, error: "login_required" }, 401);
    const url = new URL(request.url);
    const q = String(url.searchParams.get("q") || "").replace(/^@/, "").trim().slice(0, 30);
    if (q && !/^[a-zA-Z0-9_.-]{1,30}$/.test(q)) return chatJson({ ok: true, users: [] });

    const result = await env.DB.prepare(
      "SELECT p.username, a.display_name FROM accounts a LEFT JOIN collector_profiles p ON p.account_id = a.id WHERE p.username IS NOT NULL AND p.username != '' AND (? = '' OR LOWER(p.username) LIKE LOWER(?) OR LOWER(COALESCE(a.display_name, '')) LIKE LOWER(?)) ORDER BY CASE WHEN LOWER(p.username) LIKE LOWER(?) THEN 0 ELSE 1 END, p.username COLLATE NOCASE LIMIT 8"
    ).bind(q, q + "%", q + "%", q + "%").all();

    return chatJson({
      ok: true,
      users: (result.results || []).map(row => ({
        username: String(row.username),
        display_name: String(row.display_name || "Collector")
      }))
    });
  } catch (error) {
    return chatError(error, "chat_mentions_lookup_failed");
  }
}

export async function onRequest() {
  return chatJson({ ok: false, error: "method_not_allowed" }, 405);
}
