import { chatJson, currentChatAccount, chatError } from "../../_lib/chat.js";

async function ensureChatPreferences(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS chat_notification_preferences (
      account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      notification_mode TEXT NOT NULL DEFAULT 'mentions' CHECK(notification_mode IN ('all','mentions','muted')),
      sound_enabled INTEGER NOT NULL DEFAULT 1 CHECK(sound_enabled IN (0,1)),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}
async function loadPreferences(env, account) {
  await ensureChatPreferences(env);
  await env.DB.prepare("INSERT OR IGNORE INTO chat_notification_preferences (account_id) VALUES (?)").bind(account.id).run();
  const [prefs, browser, profile] = await Promise.all([
    env.DB.prepare("SELECT notification_mode, sound_enabled FROM chat_notification_preferences WHERE account_id = ?").bind(account.id).first(),
    env.DB.prepare("SELECT browser_push_enabled FROM notification_preferences WHERE account_id = ?").bind(account.id).first().catch(() => null),
    env.DB.prepare("SELECT username FROM collector_profiles WHERE account_id = ? LIMIT 1").bind(account.id).first().catch(() => null)
  ]);
  return {
    ok: true,
    preferences: {
      notification_mode: prefs?.notification_mode || "mentions",
      sound_enabled: Number(prefs?.sound_enabled ?? 1) === 1
    },
    browser_push_enabled: Number(browser?.browser_push_enabled || 0) === 1,
    vapid_public_key: env.VAPID_PUBLIC_KEY || "",
    username: String(profile?.username || "")
  };
}
export async function onRequestGet({ request, env }) {
  try {
    const account = await currentChatAccount(request, env);
    if (!account) return chatJson({ ok: false, error: "login_required" }, 401);
    return chatJson(await loadPreferences(env, account));
  } catch (error) {
    return chatError(error, "chat_preferences_read_failed");
  }
}
export async function onRequestPost({ request, env }) {
  try {
    const account = await currentChatAccount(request, env);
    if (!account) return chatJson({ ok: false, error: "login_required" }, 401);
    let data;
    try { data = await request.json(); } catch { return chatJson({ ok: false, error: "bad_request" }, 400); }
    const mode = String(data?.notification_mode || "");
    if (!["all", "mentions", "muted"].includes(mode)) {
      return chatJson({ ok: false, error: "invalid_notification_mode" }, 400);
    }
    const soundEnabled = data.sound_enabled === false ? 0 : 1;
    await ensureChatPreferences(env);
    await env.DB.prepare("INSERT OR IGNORE INTO chat_notification_preferences (account_id) VALUES (?)").bind(account.id).run();
    await env.DB.prepare("UPDATE chat_notification_preferences SET notification_mode = ?, sound_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE account_id = ?")
      .bind(mode, soundEnabled, account.id).run();
    return chatJson(await loadPreferences(env, account));
  } catch (error) {
    return chatError(error, "chat_preferences_save_failed");
  }
}
export async function onRequest() {
  return chatJson({ ok: false, error: "method_not_allowed" }, 405);
}
