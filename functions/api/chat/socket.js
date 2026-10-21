import { chatJson, currentChatAccount, chatError } from "../../_lib/chat.js";

export async function onRequestGet({ request, env }) {
  try {
    const account = await currentChatAccount(request, env);
    if (!account) return chatJson({ ok: false, error: "login_required" }, 401);
    if (!env.CHAT_ROOM || !env.CHAT_INTERNAL_SECRET) {
      return chatJson({ ok: false, error: "chat_realtime_not_configured", message: "Real-time chat is not configured on staging yet." }, 503);
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return chatJson({ ok: false, error: "websocket_required" }, 426);
    }
    const id = env.CHAT_ROOM.idFromName("pokeprizepool-community");
    const room = env.CHAT_ROOM.get(id);
    const target = new URL("https://chat-room/connect");
    target.searchParams.set("accountId", String(account.id));
    target.searchParams.set("displayName", account.display_name);
    return await room.fetch(new Request(target.toString(), request));
  } catch (error) {
    return chatError(error, "chat_socket_failed");
  }
}

export async function onRequest() {
  return chatJson({ ok: false, error: "method_not_allowed" }, 405);
}
