import { chatJson, currentChatAccount, chatError } from "../../_lib/chat.js";

export async function onRequestGet({ request, env }) {
  try {
    const account = await currentChatAccount(request, env);
    if (!account) return chatJson({ ok: false, error: "login_required" }, 401);
    const result = await env.DB.prepare(
      "SELECT id, slug, name, description, position FROM chat_channels WHERE is_active = 1 ORDER BY position, id"
    ).all();
    return chatJson({ ok: true, account, channels: result.results || [] });
  } catch (error) {
    return chatError(error, "chat_channels_failed");
  }
}

export async function onRequest() {
  return chatJson({ ok: false, error: "method_not_allowed" }, 405);
}
