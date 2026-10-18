const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

export default {
  // The public Worker URL is intentionally not an alternate chat API.
  // Pages Functions access the Durable Object through the CHAT_ROOM binding.
  async fetch() {
    return new Response("Not found", { status: 404 });
  }
};

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/broadcast" && request.method === "POST") {
      const expected = this.env.CHAT_INTERNAL_SECRET;
      const supplied = request.headers.get("x-chat-internal-secret") || "";
      if (!expected || supplied !== expected) return json({ ok: false, error: "unauthorized" }, 401);

      let event;
      try { event = await request.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
      if (!event || !["message", "delete"].includes(event.type)) {
        return json({ ok: false, error: "invalid_event" }, 400);
      }
      this.broadcast(event);
      return json({ ok: true });
    }

    if (url.pathname !== "/connect" || request.method !== "GET") {
      return new Response("Not found", { status: 404 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }

    const accountId = Number(url.searchParams.get("accountId"));
    const displayName = String(url.searchParams.get("displayName") || "Collector").slice(0, 80);
    if (!Number.isSafeInteger(accountId) || accountId < 1) return json({ ok: false, error: "invalid_identity" }, 400);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ accountId, displayName });
    server.send(JSON.stringify({ type: "connected", at: new Date().toISOString() }));
    this.broadcast({ type: "presence", online: this.state.getWebSockets().length });
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(event) {
    const payload = JSON.stringify(event);
    for (const socket of this.state.getWebSockets()) {
      try { socket.send(payload); } catch { try { socket.close(1011, "Delivery failed"); } catch {} }
    }
  }

  webSocketMessage(socket, message) {
    // Messages are written through the authenticated Pages REST endpoint.
    // The socket only supports lightweight heartbeat frames.
    if (message === "ping") {
      try { socket.send(JSON.stringify({ type: "pong", at: Date.now() })); } catch {}
    }
  }

  webSocketClose() {
    this.broadcast({ type: "presence", online: this.state.getWebSockets().length });
  }

  webSocketError() {
    this.broadcast({ type: "presence", online: this.state.getWebSockets().length });
  }
}
