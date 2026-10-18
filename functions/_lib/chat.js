export const CHAT_COOKIE = "collector_session";

export function chatJson(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}

function readCookie(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const item = part.trim();
    if (item.startsWith(name + "=")) return item.slice(name.length + 1);
  }
  return "";
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value) {
  return base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function currentChatAccount(request, env) {
  if (!env.DB) throw new Error("database_not_configured");
  const token = readCookie(request, CHAT_COOKIE);
  if (!token) return null;
  const account = await env.DB.prepare(
    "SELECT id, display_name, session_expires_at, is_admin FROM accounts WHERE session_token_hash = ? LIMIT 1"
  ).bind(await sha256(token)).first();
  if (!account || !account.session_expires_at || Number(account.session_expires_at) <= Date.now()) return null;
  return {
    id: Number(account.id),
    display_name: String(account.display_name || "Collector"),
    is_admin: Number(account.is_admin || 0) === 1
  };
}

export async function publishChatEvent(env, event) {
  if (!env.CHAT_ROOM || !env.CHAT_INTERNAL_SECRET) {
    throw new Error("chat_realtime_not_configured");
  }
  const id = env.CHAT_ROOM.idFromName("pokeprizepool-community");
  const room = env.CHAT_ROOM.get(id);
  const response = await room.fetch("https://chat-room/broadcast", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-chat-internal-secret": env.CHAT_INTERNAL_SECRET
    },
    body: JSON.stringify(event)
  });
  if (!response.ok) throw new Error("chat_realtime_publish_failed");
}

export function chatError(error, fallback = "chat_request_failed") {
  const value = String(error && error.message || "");
  if (value === "database_not_configured") return chatJson({ ok: false, error: value }, 500);
  if (value === "chat_realtime_not_configured") {
    return chatJson({ ok: false, error: value, message: "Real-time chat is not configured on staging yet." }, 503);
  }
  if (value === "chat_realtime_publish_failed") {
    return chatJson({ ok: false, error: value, message: "The chat message could not be broadcast live. Please retry." }, 503);
  }
  console.error("Community chat request failed:", error);
  return chatJson({ ok: false, error: fallback }, 500);
}
