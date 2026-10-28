import { notifyCollector } from "../_lib/collector-notifications.js";

const COOKIE = "collector_session";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
function readCookie(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const p = part.trim();
    if (p.startsWith(name + "=")) return p.slice(name.length + 1);
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
function clean(value, max = 300) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}
function normalizeTier(value) {
  return String(value || "").trim().toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ");
}
async function currentAccount(request, env) {
  const token = readCookie(request, COOKIE);
  if (!token || !env.DB) return null;
  const account = await env.DB.prepare(
    "SELECT id, display_name, email, is_admin, session_expires_at FROM accounts WHERE session_token_hash = ? LIMIT 1"
  ).bind(await sha256(token)).first();
  if (!account || !account.session_expires_at || Number(account.session_expires_at) <= Date.now()) return null;
  const membership = await env.DB.prepare(
    "SELECT membership_status, membership_tier, membership_entitlement_tier FROM accounts WHERE id = ? LIMIT 1"
  ).bind(account.id).first();
  const status = String(membership?.membership_status || "").trim().toLowerCase();
  const tier = normalizeTier(membership?.membership_entitlement_tier || membership?.membership_tier);
  account.is_admin = Number(account.is_admin || 0) === 1;
  account.can_go_live = account.is_admin || (
    ["active", "trialing"].includes(status) &&
    ["collector+", "collector plus"].includes(tier)
  );
  account.membership_tier = tier || "free";
  return account;
}
let schemaPromise = null;
async function ensureSchema(env) {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async function () {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS ripz_streams (
      id TEXT PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      product_name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','live','ended')),
      whip_url TEXT NOT NULL,
      playback_url TEXT NOT NULL,
      cloudflare_input_uid TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      live_at TEXT,
      ended_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  try { await env.DB.prepare("ALTER TABLE ripz_streams ADD COLUMN description TEXT NOT NULL DEFAULT ''").run(); } catch (_) {}
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS ripz_giveaways (stream_id TEXT PRIMARY KEY REFERENCES ripz_streams(id) ON DELETE CASCADE, enabled INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL DEFAULT 'Live Giveaway', prize TEXT NOT NULL DEFAULT '', style TEXT NOT NULL DEFAULT 'wheel', eligibility TEXT NOT NULL DEFAULT 'everyone', entries_json TEXT NOT NULL DEFAULT '[]', winner TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ripz_streams_status_created ON ripz_streams(status, live_at DESC, created_at DESC)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ripz_streams_account_status ON ripz_streams(account_id, status)").run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS ripz_recordings (
      stream_id TEXT PRIMARY KEY REFERENCES ripz_streams(id) ON DELETE CASCADE,
      cloudflare_video_uid TEXT UNIQUE,
      recording_status TEXT NOT NULL DEFAULT 'processing' CHECK(recording_status IN ('processing','ready','failed','unavailable')),
      download_status TEXT NOT NULL DEFAULT 'pending' CHECK(download_status IN ('pending','processing','ready','failed','unavailable')),
      download_url TEXT,
      error_message TEXT NOT NULL DEFAULT '',
      input_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS ripz_chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id TEXT NOT NULL REFERENCES ripz_streams(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ripz_chat_stream_id ON ripz_chat_messages(stream_id, id)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS ripz_viewers (stream_id TEXT NOT NULL REFERENCES ripz_streams(id) ON DELETE CASCADE, account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (stream_id, account_id))").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ripz_viewers_stream_seen ON ripz_viewers(stream_id, last_seen_at)").run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS ripz_guest_requests (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL REFERENCES ripz_streams(id) ON DELETE CASCADE,
      requester_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','declined','cancelled')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(stream_id, requester_account_id)
    )
  `).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ripz_guest_requests_stream_status ON ripz_guest_requests(stream_id, status, created_at)").run();
  try { await env.DB.prepare("ALTER TABLE ripz_guest_requests ADD COLUMN sfu_session_id TEXT").run(); } catch (_) {}
  try { await env.DB.prepare("ALTER TABLE ripz_guest_requests ADD COLUMN sfu_ready INTEGER NOT NULL DEFAULT 0").run(); } catch (_) {}
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS ripz_guest_sfu_sessions (
      session_id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL REFERENCES ripz_streams(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('publisher','subscriber')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ripz_guest_sfu_sessions_account ON ripz_guest_sfu_sessions(account_id, stream_id)").run();
  })();
  try {
    await schemaPromise;
  } catch (error) {
    schemaPromise = null;
    throw error;
  }
}
function streamShape(row, includePublishUrl = false) {
  if (!row) return null;
  const out = {
    id: row.id,
    title: row.title,
    product_name: row.product_name || "",
    description: row.description || "",
    status: row.status,
    host: row.host || row.display_name || "Collector",
    created_at: row.created_at,
    live_at: row.live_at || null,
    playback_url: row.playback_url,
    recording_status: row.recording_status || null,
    download_status: row.download_status || null,
    download_url: row.download_url || null,
    viewer_count: Number(row.viewer_count || 0),
    recording_message: row.recording_message || row.error_message || null
  };
  if (includePublishUrl) out.whip_url = row.whip_url;
  return out;
}

function realtimeConfigured(env) {
  return Boolean(env.REALTIME_SFU_APP_ID && env.REALTIME_SFU_BEARER_TOKEN);
}
async function realtimeApi(env, method, path, body) {
  const response = await fetch("https://rtc.live.cloudflare.com/v1/apps/" +
    encodeURIComponent(env.REALTIME_SFU_APP_ID) + path, {
      method,
      headers: {
        "Authorization": "Bearer " + env.REALTIME_SFU_BEARER_TOKEN,
        "Content-Type": "application/json"
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  let result = {};
  try { result = await response.json(); } catch (_) {}
  if (!response.ok || result.errorCode || result.error) {
    throw new Error("Realtime SFU request failed (" + response.status + "): " +
      clean(result.errorDescription || result.error || "provider_error", 220));
  }
  return result;
}
async function requireApprovedGuest(env, streamId, accountId) {
  return env.DB.prepare(`
    SELECT r.id, r.stream_id, r.requester_account_id, r.status, r.sfu_session_id, r.sfu_ready,
           s.account_id AS host_account_id, s.status AS stream_status
    FROM ripz_guest_requests r
    JOIN ripz_streams s ON s.id = r.stream_id
    WHERE r.stream_id = ? AND r.requester_account_id = ? LIMIT 1
  `).bind(streamId, accountId).first();
}
function cloudflareConfigured(env) {
  return Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_STREAM_API_TOKEN);
}
async function streamApi(env, method, path, body) {
  const url = "https://api.cloudflare.com/client/v4/accounts/" +
    encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID) + "/stream" + path;
  const response = await fetch(url, {
    method,
    headers: {
      "Authorization": "Bearer " + env.CLOUDFLARE_STREAM_API_TOKEN,
      "Content-Type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok || data.success === false) {
    const providerErrors = Array.isArray(data.errors)
      ? data.errors.slice(0, 5).map(item => ({
          code: typeof item?.code === "number" ? item.code : undefined,
          message: clean(item?.message, 240)
        })).filter(item => item.message || item.code !== undefined)
      : [];
    if (method === "POST" && path === "/live_inputs") {
      try {
        const verifyResponse = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
          method: "GET",
          headers: { "Authorization": "Bearer " + env.CLOUDFLARE_STREAM_API_TOKEN }
        });
        let verifyData = {};
        try { verifyData = await verifyResponse.json(); } catch (_) {}
        const verification = {
          httpStatus: verifyResponse.status,
          success: verifyData.success === true,
          tokenStatus: clean(verifyData.result?.status, 30),
          tokenId: clean(verifyData.result?.id, 80),
          errors: Array.isArray(verifyData.errors)
            ? verifyData.errors.slice(0, 3).map(item => ({
                code: typeof item?.code === "number" ? item.code : undefined,
                message: clean(item?.message, 200)
              })).filter(item => item.message || item.code !== undefined)
            : []
        };
        console.error("Ripz API token verification:", JSON.stringify(verification));
      } catch (_) {
        console.error("Ripz API token verification: request_failed");
      }
      try {
        const scopeResponse = await fetch(
          "https://api.cloudflare.com/client/v4/accounts/" +
            encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID) + "/stream/live_inputs?per_page=1",
          { method: "GET", headers: { "Authorization": "Bearer " + env.CLOUDFLARE_STREAM_API_TOKEN } }
        );
        let scopeData = {};
        try { scopeData = await scopeResponse.json(); } catch (_) {}
        const scopeCheck = {
          httpStatus: scopeResponse.status,
          success: scopeData.success === true,
          configuredAccountId: clean(env.CLOUDFLARE_ACCOUNT_ID, 40),
          errors: Array.isArray(scopeData.errors)
            ? scopeData.errors.slice(0, 3).map(item => ({
                code: typeof item?.code === "number" ? item.code : undefined,
                message: clean(item?.message, 200)
              })).filter(item => item.message || item.code !== undefined)
            : []
        };
        console.error("Ripz Stream account access check:", JSON.stringify(scopeCheck));
      } catch (_) {
        console.error("Ripz Stream account access check: request_failed");
      }
    }
    console.error("Ripz Stream API request failed:", method, path, response.status, JSON.stringify(providerErrors));
    throw new Error("stream_provider_error");
  }
  return data.result || {};
}
async function findOwnedStream(env, streamId) {
  return env.DB.prepare(`
    SELECT s.*,
           (SELECT COUNT(DISTINCT v.account_id) FROM ripz_viewers v WHERE v.stream_id = s.id AND v.account_id <> s.account_id AND unixepoch(v.last_seen_at) >= unixepoch() - 45) AS viewer_count,
           COALESCE(NULLIF(p.username, ''), NULLIF(a.display_name, ''), 'Collector') AS host,
           r.cloudflare_video_uid AS recording_uid,
           r.recording_status,
           r.download_status,
           r.download_url,
           r.error_message
    FROM ripz_streams s
    JOIN accounts a ON a.id = s.account_id
    LEFT JOIN collector_profiles p ON p.account_id = a.id
    LEFT JOIN ripz_recordings r ON r.stream_id = s.id
    WHERE s.id = ? LIMIT 1
  `).bind(streamId).first();
}
export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "database_not_configured" }, 503);
  try {
    const account = await currentAccount(request, env);
    if (!account) return json({ ok: false, error: "login_required" }, 401);
    await ensureSchema(env);
    const { results: liveRows = [] } = await env.DB.prepare(`
      SELECT s.id, s.account_id, s.title, s.product_name, s.status, s.created_at, s.live_at, s.playback_url,
             (SELECT COUNT(DISTINCT v.account_id) FROM ripz_viewers v WHERE v.stream_id = s.id AND v.account_id <> s.account_id AND unixepoch(v.last_seen_at) >= unixepoch() - 45) AS viewer_count,
             COALESCE(NULLIF(p.username, ''), NULLIF(a.display_name, ''), 'Collector') AS host
      FROM ripz_streams s
      JOIN accounts a ON a.id = s.account_id
      LEFT JOIN collector_profiles p ON p.account_id = a.id
      WHERE s.status = 'live'
      ORDER BY COALESCE(s.live_at, s.created_at) DESC
      LIMIT 40
    `).all();
    const { results: pastRows = [] } = await env.DB.prepare(`
      SELECT s.id, s.account_id, s.title, s.product_name, s.description, s.status, s.created_at, s.live_at, s.ended_at,
             r.cloudflare_video_uid, r.recording_status, r.download_status,
             COALESCE(NULLIF(p.username, ''), NULLIF(a.display_name, ''), 'Collector') AS host
      FROM ripz_streams s
      JOIN accounts a ON a.id = s.account_id
      LEFT JOIN collector_profiles p ON p.account_id = a.id
      LEFT JOIN ripz_recordings r ON r.stream_id = s.id
      WHERE s.status = 'ended' AND r.cloudflare_video_uid IS NOT NULL AND r.cloudflare_video_uid <> ''
      ORDER BY COALESCE(s.ended_at, s.live_at, s.created_at) DESC
      LIMIT 30
    `).all();
    const myRow = await env.DB.prepare(`
      SELECT s.*,
             (SELECT COUNT(DISTINCT v.account_id) FROM ripz_viewers v WHERE v.stream_id = s.id AND v.account_id <> s.account_id AND unixepoch(v.last_seen_at) >= unixepoch() - 45) AS viewer_count,
             COALESCE(NULLIF(p.username, ''), NULLIF(a.display_name, ''), 'Collector') AS host,
             r.recording_status, r.download_status, r.download_url, r.error_message
      FROM ripz_streams s
      JOIN accounts a ON a.id = s.account_id
      LEFT JOIN collector_profiles p ON p.account_id = a.id
      LEFT JOIN ripz_recordings r ON r.stream_id = s.id
      WHERE s.account_id = ?
      ORDER BY CASE WHEN s.status IN ('ready','live') THEN 0 ELSE 1 END,
               COALESCE(s.ended_at, s.created_at) DESC
      LIMIT 1
    `).bind(account.id).first();
    const url = new URL(request.url);
    const streamId = clean(url.searchParams.get("stream_id"), 80);
    let messages;
    if (streamId) {
      const stream = await findOwnedStream(env, streamId);
      if (!stream || (stream.status !== "live" && Number(stream.account_id) !== Number(account.id) && !account.is_admin)) {
        return json({ ok: false, error: "stream_not_found" }, 404);
      }
      const { results = [] } = await env.DB.prepare(`
        SELECT * FROM (
          SELECT m.id, m.message, m.created_at,
                 COALESCE(NULLIF(p.username, ''), NULLIF(a.display_name, ''), 'Collector') AS username
          FROM ripz_chat_messages m
          JOIN accounts a ON a.id = m.account_id
          LEFT JOIN collector_profiles p ON p.account_id = a.id
          WHERE m.stream_id = ?
          ORDER BY m.id DESC LIMIT 80
        ) ORDER BY id ASC
      `).bind(streamId).all();
      messages = results;
    }
    return json({
      ok: true,
      account: { display_name: account.display_name || "Collector" },
      membership_tier: account.membership_tier,
      authenticated: true,
      can_go_live: Boolean(account.can_go_live),
      streaming_configured: cloudflareConfigured(env),
      live_streams: liveRows.map(row => streamShape(row, false)),
      past_streams: pastRows.map(row => ({ ...streamShape(row, false), ended_at: row.ended_at || null, replay_url: "https://iframe.videodelivery.net/" + encodeURIComponent(row.cloudflare_video_uid) })),
      my_stream: streamShape(myRow, true),
      ...(messages ? { messages } : {})
    });
  } catch (error) {
    console.error("Ripz load failed:", error);
    return json({ ok: false, error: "ripz_unavailable", message: "Ripz is temporarily unavailable. Please try again." }, 500);
  }
}
export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "database_not_configured" }, 503);
  try {
    const account = await currentAccount(request, env);
    if (!account) return json({ ok: false, error: "login_required" }, 401);
    await ensureSchema(env);
    let data;
    try { data = await request.json(); } catch (_) { return json({ ok: false, error: "bad_request" }, 400); }
    const action = clean(data?.action, 30);

    if (action === "viewer_heartbeat" || action === "viewer_leave") {
      const streamId = clean(data.stream_id, 100);
      if (!streamId) return json({ ok: false, error: "stream_id_required" }, 400);
      const stream = await env.DB.prepare("SELECT id, account_id, status FROM ripz_streams WHERE id = ? LIMIT 1").bind(streamId).first();
      if (!stream || stream.status !== "live") {
        await env.DB.prepare("DELETE FROM ripz_viewers WHERE stream_id = ? AND account_id = ?").bind(streamId, account.id).run();
        return json({ ok: false, error: "stream_not_live", viewer_count: 0 }, 409);
      }
      if (action === "viewer_leave" || Number(stream.account_id) === Number(account.id)) {
        await env.DB.prepare("DELETE FROM ripz_viewers WHERE stream_id = ? AND account_id = ?").bind(streamId, account.id).run();
      } else {
        await env.DB.prepare("INSERT INTO ripz_viewers (stream_id, account_id, last_seen_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(stream_id, account_id) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP").bind(streamId, account.id).run();
      }
      const count = await env.DB.prepare("SELECT COUNT(DISTINCT account_id) AS viewer_count FROM ripz_viewers WHERE stream_id = ? AND account_id <> ? AND unixepoch(last_seen_at) >= unixepoch() - 45").bind(streamId, stream.account_id).first();
      return json({ ok: true, viewer_count: Number(count?.viewer_count || 0) });
    }


    if (action === "guest_request") {
      const streamId = clean(data.stream_id, 100);
      if (!streamId) return json({ ok: false, error: "stream_id_required" }, 400);
      const stream = await env.DB.prepare("SELECT id, account_id, status FROM ripz_streams WHERE id = ? LIMIT 1").bind(streamId).first();
      if (!stream || stream.status !== "live") return json({ ok: false, error: "stream_not_live" }, 409);
      if (Number(stream.account_id) === Number(account.id)) return json({ ok: false, error: "host_cannot_request" }, 400);
      const existing = await env.DB.prepare("SELECT id, status FROM ripz_guest_requests WHERE stream_id = ? AND requester_account_id = ? LIMIT 1").bind(streamId, account.id).first();
      if (existing && ["pending", "approved"].includes(existing.status)) {
        return json({ ok: true, request: { id: existing.id, status: existing.status } });
      }
      const requestId = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO ripz_guest_requests (id, stream_id, requester_account_id, status, created_at, updated_at)
        VALUES (?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(stream_id, requester_account_id) DO UPDATE SET id=excluded.id, status='pending', created_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
      `).bind(requestId, streamId, account.id).run();
      const saved = await env.DB.prepare("SELECT id, status FROM ripz_guest_requests WHERE stream_id = ? AND requester_account_id = ? LIMIT 1").bind(streamId, account.id).first();
      return json({ ok: true, request: saved || { id: requestId, status: "pending" } }, 201);
    }

    if (action === "guest_state") {
      const streamId = clean(data.stream_id, 100);
      if (!streamId) return json({ ok: false, error: "stream_id_required" }, 400);
      const stream = await env.DB.prepare("SELECT id, account_id, status FROM ripz_streams WHERE id = ? LIMIT 1").bind(streamId).first();
      if (!stream || stream.status !== "live") return json({ ok: true, requests: [], own_request: null });
      if (Number(stream.account_id) === Number(account.id)) {
        const { results = [] } = await env.DB.prepare(`
          SELECT r.id, r.status, r.created_at,
                 COALESCE(NULLIF(p.username, ''), NULLIF(a.display_name, ''), 'Collector') AS username
          FROM ripz_guest_requests r
          JOIN accounts a ON a.id = r.requester_account_id
          LEFT JOIN collector_profiles p ON p.account_id = a.id
          WHERE r.stream_id = ? AND r.status IN ('pending','approved')
          ORDER BY CASE WHEN r.status='pending' THEN 0 ELSE 1 END, r.created_at ASC
          LIMIT 30
        `).bind(streamId).all();
        return json({ ok: true, requests: results, own_request: null });
      }
      const own = await env.DB.prepare("SELECT id, status, updated_at FROM ripz_guest_requests WHERE stream_id = ? AND requester_account_id = ? LIMIT 1").bind(streamId, account.id).first();
      return json({ ok: true, requests: [], own_request: own || null });
    }

    if (action === "guest_decide") {
      const requestId = clean(data.request_id, 100);
      const decision = data.decision === "approve" ? "approved" : (data.decision === "decline" ? "declined" : "");
      if (!requestId || !decision) return json({ ok: false, error: "bad_request" }, 400);
      const row = await env.DB.prepare(`
        SELECT r.id, r.stream_id, r.status, s.account_id AS host_account_id, s.status AS stream_status
        FROM ripz_guest_requests r JOIN ripz_streams s ON s.id = r.stream_id
        WHERE r.id = ? LIMIT 1
      `).bind(requestId).first();
      if (!row) return json({ ok: false, error: "request_not_found" }, 404);
      if (Number(row.host_account_id) !== Number(account.id) && !account.is_admin) return json({ ok: false, error: "not_stream_owner" }, 403);
      if (row.stream_status !== "live") return json({ ok: false, error: "stream_not_live" }, 409);
      if (row.status !== "pending") return json({ ok: false, error: "request_already_decided" }, 409);
      await env.DB.prepare("UPDATE ripz_guest_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").bind(decision, requestId).run();
      return json({ ok: true, status: decision });
    }


    if (action === "guest_sfu_create") {
      if (!realtimeConfigured(env)) return json({ ok: false, error: "realtime_not_configured" }, 503);
      const streamId = clean(data.stream_id, 100);
      const guest = await requireApprovedGuest(env, streamId, account.id);
      if (!guest || guest.status !== "approved" || guest.stream_status !== "live") return json({ ok: false, error: "guest_not_approved" }, 403);
      if (guest.sfu_session_id) {
        return json({ ok: true, app_id: env.REALTIME_SFU_APP_ID, session_id: guest.sfu_session_id, ready: Number(guest.sfu_ready) === 1 });
      }
      const created = await realtimeApi(env, "POST", "/sessions/new");
      const sessionId = clean(created.sessionId, 200);
      if (!sessionId) return json({ ok: false, error: "realtime_session_missing" }, 502);
      await env.DB.prepare("INSERT INTO ripz_guest_sfu_sessions (session_id, stream_id, account_id, role) VALUES (?, ?, ?, 'publisher')").bind(sessionId, streamId, account.id).run();
      await env.DB.prepare("UPDATE ripz_guest_requests SET sfu_session_id = ?, sfu_ready = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'approved'").bind(sessionId, guest.id).run();
      return json({ ok: true, app_id: env.REALTIME_SFU_APP_ID, session_id: sessionId, ready: false });
    }

    if (action === "guest_sfu_publish") {
      if (!realtimeConfigured(env)) return json({ ok: false, error: "realtime_not_configured" }, 503);
      const streamId = clean(data.stream_id, 100);
      const sessionId = clean(data.session_id, 200);
      const sdp = data.session_description;
      const tracks = Array.isArray(data.tracks) ? data.tracks.slice(0, 2) : [];
      const guest = await requireApprovedGuest(env, streamId, account.id);
      if (!guest || guest.status !== "approved" || guest.stream_status !== "live" || guest.sfu_session_id !== sessionId) return json({ ok: false, error: "guest_session_not_authorized" }, 403);
      const owned = await env.DB.prepare("SELECT session_id FROM ripz_guest_sfu_sessions WHERE session_id = ? AND stream_id = ? AND account_id = ? AND role = 'publisher' LIMIT 1").bind(sessionId, streamId, account.id).first();
      if (!owned) return json({ ok: false, error: "guest_session_not_authorized" }, 403);
      if (!sdp || sdp.type !== "offer" || !clean(sdp.sdp, 30000) || !tracks.length) return json({ ok: false, error: "bad_sdp_offer" }, 400);
      const safeTracks = tracks.map((track) => ({
        location: "local",
        mid: clean(track.mid, 20),
        trackName: track.kind === "audio" ? "microphone" : "camera"
      })).filter(track => track.mid);
      if (!safeTracks.length || safeTracks.some(track => !["camera","microphone"].includes(track.trackName))) return json({ ok: false, error: "bad_track_list" }, 400);
      const result = await realtimeApi(env, "POST", "/sessions/" + encodeURIComponent(sessionId) + "/tracks/new", {
        sessionDescription: { type: "offer", sdp: sdp.sdp },
        tracks: safeTracks
      });
      if (!result.sessionDescription || result.sessionDescription.type !== "answer") return json({ ok: false, error: "realtime_answer_missing" }, 502);
      const successful = Array.isArray(result.tracks) && result.tracks.length > 0 && result.tracks.every(track => !track.errorCode && !track.error);
      if (!successful) return json({ ok: false, error: "realtime_track_publish_failed", details: (result.tracks || []).map(track => ({ trackName: track.trackName, errorCode: track.errorCode, errorDescription: clean(track.errorDescription, 180) })) }, 502);
      await env.DB.prepare("UPDATE ripz_guest_requests SET sfu_ready = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(guest.id).run();
      return json({ ok: true, session_description: result.sessionDescription, tracks: result.tracks });
    }

    if (action === "guest_sfu_list") {
      const streamId = clean(data.stream_id, 100);
      const stream = await env.DB.prepare("SELECT id, account_id, status FROM ripz_streams WHERE id = ? LIMIT 1").bind(streamId).first();
      if (!stream || stream.status !== "live") return json({ ok: false, error: "stream_not_live" }, 409);
      const { results = [] } = await env.DB.prepare(`
        SELECT r.sfu_session_id AS session_id
        FROM ripz_guest_requests r
        WHERE r.stream_id = ? AND r.status = 'approved' AND r.sfu_ready = 1 AND r.sfu_session_id IS NOT NULL
        ORDER BY r.updated_at ASC LIMIT 4
      `).bind(streamId).all();
      return json({ ok: true, publishers: results.map(row => ({ session_id: row.session_id, tracks: ["camera", "microphone"] })) });
    }

    if (action === "guest_sfu_subscriber_create") {
      if (!realtimeConfigured(env)) return json({ ok: false, error: "realtime_not_configured" }, 503);
      const streamId = clean(data.stream_id, 100);
      const stream = await env.DB.prepare("SELECT id, status FROM ripz_streams WHERE id = ? LIMIT 1").bind(streamId).first();
      if (!stream || stream.status !== "live") return json({ ok: false, error: "stream_not_live" }, 409);
      const { results = [] } = await env.DB.prepare("SELECT sfu_session_id AS session_id FROM ripz_guest_requests WHERE stream_id = ? AND status = 'approved' AND sfu_ready = 1 AND sfu_session_id IS NOT NULL LIMIT 4").bind(streamId).all();
      if (!results.length) return json({ ok: true, app_id: env.REALTIME_SFU_APP_ID, session_id: null, publishers: [] });
      const created = await realtimeApi(env, "POST", "/sessions/new");
      const sessionId = clean(created.sessionId, 200);
      if (!sessionId) return json({ ok: false, error: "realtime_session_missing" }, 502);
      await env.DB.prepare("INSERT INTO ripz_guest_sfu_sessions (session_id, stream_id, account_id, role) VALUES (?, ?, ?, 'subscriber')").bind(sessionId, streamId, account.id).run();
      return json({ ok: true, app_id: env.REALTIME_SFU_APP_ID, session_id: sessionId, publishers: results.map(row => ({ session_id: row.session_id, tracks: ["camera", "microphone"] })) });
    }

    if (action === "guest_sfu_subscribe") {
      if (!realtimeConfigured(env)) return json({ ok: false, error: "realtime_not_configured" }, 503);
      const streamId = clean(data.stream_id, 100);
      const sessionId = clean(data.session_id, 200);
      const sdp = data.session_description;
      const publishers = Array.isArray(data.publishers) ? data.publishers.slice(0, 8) : [];
      const owned = await env.DB.prepare("SELECT session_id FROM ripz_guest_sfu_sessions WHERE session_id = ? AND stream_id = ? AND account_id = ? AND role = 'subscriber' LIMIT 1").bind(sessionId, streamId, account.id).first();
      if (!owned) return json({ ok: false, error: "subscriber_session_not_authorized" }, 403);
      const stream = await env.DB.prepare("SELECT id, status FROM ripz_streams WHERE id = ? LIMIT 1").bind(streamId).first();
      if (!stream || stream.status !== "live") return json({ ok: false, error: "stream_not_live" }, 409);
      const { results: allowedRows = [] } = await env.DB.prepare("SELECT sfu_session_id AS session_id FROM ripz_guest_requests WHERE stream_id = ? AND status = 'approved' AND sfu_ready = 1 AND sfu_session_id IS NOT NULL").bind(streamId).all();
      const allowed = new Set(allowedRows.map(row => row.session_id));
      const remoteTracks = [];
      for (const publisher of publishers) {
        const publisherId = clean(publisher.session_id, 200);
        if (!allowed.has(publisherId)) continue;
        for (const trackName of ["camera", "microphone"]) remoteTracks.push({ location: "remote", sessionId: publisherId, trackName });
      }
      if (!remoteTracks.length) return json({ ok: true, session_description: null, tracks: [] });
      const result = await realtimeApi(env, "POST", "/sessions/" + encodeURIComponent(sessionId) + "/tracks/new", { tracks: remoteTracks });
      if (!result.sessionDescription || result.sessionDescription.type !== "offer") return json({ ok: false, error: "realtime_offer_missing" }, 502);
      return json({ ok: true, session_description: result.sessionDescription, tracks: result.tracks || [] });
    }

    if (action === "guest_sfu_subscriber_answer") {
      if (!realtimeConfigured(env)) return json({ ok: false, error: "realtime_not_configured" }, 503);
      const streamId = clean(data.stream_id, 100);
      const sessionId = clean(data.session_id, 200);
      const sdp = data.session_description;
      const owned = await env.DB.prepare("SELECT session_id FROM ripz_guest_sfu_sessions WHERE session_id = ? AND stream_id = ? AND account_id = ? AND role = 'subscriber' LIMIT 1").bind(sessionId, streamId, account.id).first();
      if (!owned) return json({ ok: false, error: "subscriber_session_not_authorized" }, 403);
      if (!sdp || sdp.type !== "answer" || !clean(sdp.sdp, 30000)) return json({ ok: false, error: "bad_sdp_answer" }, 400);
      const result = await realtimeApi(env, "PUT", "/sessions/" + encodeURIComponent(sessionId) + "/renegotiate", { sessionDescription: { type: "answer", sdp: sdp.sdp } });
      return json({ ok: true, result });
    }

    if (action === "guest_cancel") {
      const streamId = clean(data.stream_id, 100);
      if (!streamId) return json({ ok: false, error: "stream_id_required" }, 400);
      await env.DB.prepare("UPDATE ripz_guest_requests SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE stream_id = ? AND requester_account_id = ? AND status IN ('pending','approved')").bind(streamId, account.id).run();
      return json({ ok: true });
    }

    if (action === "giveaway_state") {
      const streamId = clean(data.stream_id, 100);
      if (!streamId) return json({ ok: false, error: "stream_id_required" }, 400);
      const row = await env.DB.prepare("SELECT g.enabled, g.title, g.prize, g.style, g.eligibility, g.entries_json, g.winner FROM ripz_giveaways g JOIN ripz_streams s ON s.id = g.stream_id WHERE g.stream_id = ? AND s.status = 'live' LIMIT 1").bind(streamId).first();
      if (!row) return json({ ok: true, giveaway: null });
      let entries = []; try { entries = JSON.parse(row.entries_json || "[]"); } catch (_) {}
      return json({ ok: true, giveaway: { enabled: Boolean(row.enabled), title: row.title, prize: row.prize, style: row.style, eligibility: row.eligibility, entries, winner: row.winner || "" } });
    }
    if (action === "giveaway_save") {
      const streamId = clean(data.stream_id, 100);
      if (!streamId) return json({ ok: false, error: "stream_id_required" }, 400);
      const stream = await env.DB.prepare("SELECT id, account_id, status FROM ripz_streams WHERE id = ? LIMIT 1").bind(streamId).first();
      if (!stream || Number(stream.account_id) !== Number(account.id) || !["ready", "live"].includes(stream.status)) return json({ ok: false, error: "not_stream_owner", message: "Only the host can control this stream's giveaway." }, 403);
      const title = clean(data.title, 100) || "Live Giveaway", prize = clean(data.prize, 160);
      const style = ["wheel", "duck_race"].includes(data.style) ? data.style : "wheel";
      const eligibility = ["everyone", "collector_plus", "followers"].includes(data.eligibility) ? data.eligibility : "everyone";
      const entries = Array.isArray(data.entries) ? data.entries.map(item => clean(item, 60)).filter(Boolean).slice(0, 500) : [];
      const winner = clean(data.winner, 60), enabled = data.enabled ? 1 : 0;
      await env.DB.prepare("INSERT INTO ripz_giveaways (stream_id, enabled, title, prize, style, eligibility, entries_json, winner, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(stream_id) DO UPDATE SET enabled=excluded.enabled, title=excluded.title, prize=excluded.prize, style=excluded.style, eligibility=excluded.eligibility, entries_json=excluded.entries_json, winner=excluded.winner, updated_at=CURRENT_TIMESTAMP").bind(streamId, enabled, title, prize, style, eligibility, JSON.stringify(entries), winner).run();
      return json({ ok: true });
    }
    if (action === "giveaway_viewers") {
      const streamId = clean(data.stream_id, 100);
      if (!streamId) return json({ ok: false, error: "stream_id_required" }, 400);
      const stream = await env.DB.prepare("SELECT id, account_id, status FROM ripz_streams WHERE id = ? LIMIT 1").bind(streamId).first();
      if (!stream || Number(stream.account_id) !== Number(account.id) || stream.status !== "live") {
        return json({ ok: false, error: "not_live_stream_owner", message: "Only the host of their own live stream can load giveaway entries." }, 403);
      }
      const giveaway = await env.DB.prepare("SELECT eligibility FROM ripz_giveaways WHERE stream_id = ? LIMIT 1").bind(streamId).first();
      const eligibility = giveaway?.eligibility || "everyone";
      const { results: viewers = [] } = await env.DB.prepare(`
        SELECT DISTINCT v.account_id, COALESCE(NULLIF(p.username, ''), NULLIF(a.display_name, ''), 'Collector') AS username
        FROM ripz_viewers v
        JOIN accounts a ON a.id = v.account_id
        LEFT JOIN collector_profiles p ON p.account_id = a.id
        WHERE v.stream_id = ? AND v.account_id <> ? AND unixepoch(v.last_seen_at) >= unixepoch() - 45
          AND (? <> 'collector_plus' OR (
            lower(COALESCE(a.membership_status, '')) IN ('active','trialing')
            AND lower(replace(replace(COALESCE(a.membership_entitlement_tier, a.membership_tier, ''), '_', ' '), '-', ' ')) IN ('collector+', 'collector plus')
          ))
        ORDER BY username COLLATE NOCASE LIMIT 500
      `).bind(streamId, account.id, eligibility).all();
      return json({ ok: true, viewers: viewers.map(viewer => ({ username: clean(viewer.username, 60) })) });
    }

    if (action === "start") {
      if (!account.can_go_live) return json({ ok: false, error: "collector_plus_required", message: "Only active Collector+ members can host a Ripz stream." }, 403);
      const title = clean(data.title, 100);
      const productName = clean(data.product_name, 120);
      const description = clean(data.description, 1000);
      if (title.length < 3 || productName.length < 2) {
        return json({ ok: false, error: "title_and_product_required", message: "Enter a stream title and what you are ripping." }, 400);
      }
      const existing = await env.DB.prepare(`
        SELECT s.*, COALESCE(NULLIF(p.username, ''), NULLIF(a.display_name, ''), 'Collector') AS host
        FROM ripz_streams s
        JOIN accounts a ON a.id = s.account_id
        LEFT JOIN collector_profiles p ON p.account_id = a.id
        WHERE s.account_id = ? AND s.status IN ('ready','live')
        ORDER BY s.created_at DESC LIMIT 1
      `).bind(account.id).first();
      if (existing) return json({ ok: true, reused: true, stream: streamShape(existing, true) });
      if (!cloudflareConfigured(env)) {
        return json({ ok: false, error: "streaming_not_configured", message: "Live streaming is not connected yet. Please contact PokePrizePool support." }, 503);
      }
      let providerStream;
      try {
        providerStream = await streamApi(env, "POST", "/live_inputs", {
          meta: { name: title, app: "PokePrizePool Ripz", product_name: productName, description: description, account_id: String(account.id) },
          recording: { mode: "automatic", requireSignedURLs: false, timeoutSeconds: 0 }
        });
      } catch (_) {
        return json({ ok: false, error: "stream_provider_error", message: "The live video service could not create a stream. Please try again later." }, 502);
      }
      const uid = clean(providerStream.uid, 100);
      const whipUrl = clean(providerStream.webRTC?.url || providerStream.webRtc?.url, 1000);
      const playbackUrl = clean(providerStream.webRTCPlayback?.url || providerStream.webRtcPlayback?.url, 1000);
      if (!uid || !/^https:\/\//i.test(whipUrl) || !/^https:\/\//i.test(playbackUrl)) {
        if (uid) streamApi(env, "DELETE", "/live_inputs/" + encodeURIComponent(uid)).catch(() => {});
        return json({ ok: false, error: "stream_provider_unavailable", message: "The live video account is not returning browser-streaming endpoints yet." }, 502);
      }
      try {
        await env.DB.prepare(`
          INSERT INTO ripz_streams (id, account_id, title, product_name, description, status, whip_url, playback_url, cloudflare_input_uid)
          VALUES (?, ?, ?, ?, ?, 'ready', ?, ?, ?)
        `).bind(uid, account.id, title, productName, description, whipUrl, playbackUrl, uid).run();
      } catch (error) {
        streamApi(env, "DELETE", "/live_inputs/" + encodeURIComponent(uid)).catch(() => {});
        throw error;
      }
      try {
        await env.DB.prepare("INSERT OR IGNORE INTO ripz_recordings (stream_id) VALUES (?)").bind(uid).run();
      } catch (recordingError) {
        console.warn("Ripz recording tracking initialization failed:", recordingError);
      }
      const row = await findOwnedStream(env, uid);
      return json({ ok: true, reused: false, stream: streamShape(row, true) }, 201);
    }

    if (action === "publish") {
      if (!account.can_go_live) return json({ ok: false, error: "collector_plus_required" }, 403);
      const streamId = clean(data.stream_id, 100);
      if (!streamId) return json({ ok: false, error: "stream_not_found" }, 404);
      const stream = await env.DB.prepare(`
        SELECT s.id, s.title, s.product_name, s.status,
               COALESCE(NULLIF(p.username, ''), NULLIF(a.display_name, ''), 'A collector') AS host
        FROM ripz_streams s
        JOIN accounts a ON a.id = s.account_id
        LEFT JOIN collector_profiles p ON p.account_id = a.id
        WHERE s.id = ? AND s.account_id = ? AND s.status IN ('ready','live')
        LIMIT 1
      `).bind(streamId, account.id).first();
      if (!stream) return json({ ok: false, error: "stream_not_found" }, 404);

      let becameLive = false;
      if (stream.status === "ready") {
        const result = await env.DB.prepare(`
          UPDATE ripz_streams
          SET status = 'live', live_at = COALESCE(live_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND account_id = ? AND status = 'ready'
        `).bind(streamId, account.id).run();
        becameLive = Number(result.meta?.changes || 0) > 0;
      }

      // Notify each distinct account that has browser push enabled and an active
      // subscription. Notification delivery must never interrupt a successful go-live.
      if (becameLive) {
        try {
          const { results: recipients = [] } = await env.DB.prepare(`
            SELECT DISTINCT prefs.account_id
            FROM notification_preferences prefs
            JOIN push_subscriptions subs ON subs.account_id = prefs.account_id
            WHERE prefs.browser_push_enabled = 1 AND prefs.account_id <> ?
          `).bind(account.id).all();
          const notification = {
            type: "ripz_live",
            title: String(stream.host || "A collector") + " is live on Ripz",
            body: [String(stream.title || "A live rip"), String(stream.product_name || "").trim()].filter(Boolean).join(" — "),
            url: "/ripz.html",
            data: { stream_id: stream.id, host: String(stream.host || "A collector") }
          };
          await Promise.all(recipients.map(recipient => notifyCollector(env, recipient.account_id, notification)));
          console.info("Ripz live notification fan-out completed:", recipients.length);
        } catch (notificationError) {
          console.warn("Ripz live notification fan-out failed:", notificationError);
        }
      }
      return json({ ok: true });
    }

    if (action === "recording") {
      const streamId = clean(data.stream_id, 100);
      console.error("Ripz recording check entered:", JSON.stringify({
        accountId: Number(account.id),
        hasStreamId: Boolean(streamId),
        streamIdLength: streamId.length
      }));
      if (!streamId) return json({ ok: false, error: "stream_id_required" }, 400);
      const stream = await findOwnedStream(env, streamId);
      if (!stream) {
        console.error("Ripz recording check: stream row not found");
        return json({ ok: false, error: "stream_not_found" }, 404);
      }
      if (Number(stream.account_id) !== Number(account.id) && !account.is_admin) {
        return json({ ok: false, error: "not_stream_owner" }, 403);
      }
      if (stream.status !== "ended") return json({ ok: false, error: "stream_not_ended" }, 409);
      const recording = await env.DB.prepare("SELECT * FROM ripz_recordings WHERE stream_id = ? LIMIT 1").bind(streamId).first();
      console.error("Ripz recording check state:", JSON.stringify({
        streamStatus: clean(stream.status, 20),
        recordingRowExists: Boolean(recording),
        storedVideoUidPresent: Boolean(recording?.cloudflare_video_uid),
        inputDeleted: Number(recording?.input_deleted || 0),
        endedAtPresent: Boolean(stream.ended_at)
      }));
      if (!recording) {
        console.error("Ripz recording check: recording tracking row missing for this stream");
        return json({
          ok: true, recording_status: "unavailable", download_status: "unavailable",
          message: "This stream started before automatic recording was enabled. New streams can be downloaded after they end."
        });
      }
      if (!cloudflareConfigured(env)) {
        return json({ ok: false, error: "streaming_not_configured" }, 503);
      }

      let video = null;
      let videoUid = clean(recording.cloudflare_video_uid, 100);
      if (videoUid) {
        try {
          video = await streamApi(env, "GET", "/" + encodeURIComponent(videoUid));
        } catch (videoError) {
          // A stored video UID can become stale if a previous lookup returned an
          // incomplete recording. Rediscover it from the live input before giving up.
          console.warn("Ripz stored recording lookup failed; rediscovering from live input:", clean(videoError?.message, 180));
          videoUid = "";
          video = null;
        }
      }
      if (!videoUid) {
        let recordings = [];
        try {
          const result = await streamApi(env, "GET", "/live_inputs/" + encodeURIComponent(stream.cloudflare_input_uid) + "/videos");
          recordings = Array.isArray(result) ? result : (Array.isArray(result.videos) ? result.videos : []);
        } catch (recordingLookupError) {
          console.warn("Ripz live recording lookup failed:", clean(recordingLookupError?.message, 180));
          const message = "Cloudflare could not find the recording yet. Try checking again shortly; if it keeps failing, the recording may not be available.";
          await env.DB.prepare("UPDATE ripz_recordings SET recording_status='processing', download_status='processing', error_message=?, updated_at=CURRENT_TIMESTAMP WHERE stream_id=?").bind(message, streamId).run();
          return json({ ok: true, recording_status: "processing", download_status: "processing", message });
        }
        const inputMatches = recordings.filter(item => String(item.liveInput || item.live_input || "") === String(stream.cloudflare_input_uid));
        video = inputMatches[0] || recordings[0] || null;
        videoUid = clean(video?.uid, 100);
        console.error("Ripz live-input recording list result:", JSON.stringify({
          count: recordings.length,
          inputMatches: inputMatches.length,
          selectedVideoFound: Boolean(videoUid),
          states: recordings.slice(0, 5).map(item => clean(item?.status?.state || (item?.readyToStream ? "ready" : "processing"), 30))
        }));
        if (!videoUid) {
          // If the input has no associated video yet, inspect its persisted Cloudflare
          // settings so we can distinguish a recording-mode issue from processing delay.
          try {
            const inputInfo = await streamApi(env, "GET", "/live_inputs/" + encodeURIComponent(stream.cloudflare_input_uid));
            console.error("Ripz live-input recording configuration:", JSON.stringify({
              inputFound: Boolean(inputInfo.uid),
              recordingMode: clean(inputInfo.recording?.mode, 30),
              enabled: inputInfo.enabled !== false,
              created: clean(inputInfo.created, 40),
              metaName: clean(inputInfo.meta?.name, 100)
            }));
          } catch (inputInfoError) {
            console.error("Ripz live-input configuration lookup failed:", clean(inputInfoError?.message, 180));
          }
          const endedAt = Date.parse(String(stream.ended_at || "").replace(" ", "T") + "Z");
          const timedOut = Number.isFinite(endedAt) && Date.now() - endedAt > 10 * 60 * 1000;
          if (timedOut) {
            const message = "Cloudflare has not returned a recording for this stream. Check the Live Inputs page in Cloudflare Stream to see whether a recording was created.";
            await env.DB.prepare("UPDATE ripz_recordings SET recording_status='unavailable', download_status='unavailable', error_message=?, updated_at=CURRENT_TIMESTAMP WHERE stream_id=?").bind(message, streamId).run();
            return json({ ok: true, recording_status: "unavailable", download_status: "unavailable", message });
          }
          const message = "Your recording is being finalized by Cloudflare. Check again in about a minute.";
          await env.DB.prepare("UPDATE ripz_recordings SET recording_status='processing', error_message=?, updated_at=CURRENT_TIMESTAMP WHERE stream_id=?").bind(message, streamId).run();
          return json({
            ok: true, recording_status: "processing", download_status: recording.download_status || "pending",
            message
          });
        }
        await env.DB.prepare("UPDATE ripz_recordings SET cloudflare_video_uid=?, updated_at=CURRENT_TIMESTAMP WHERE stream_id=?").bind(videoUid, streamId).run();
      }

      const providerState = String(video?.status?.state || (video?.readyToStream ? "ready" : "processing")).toLowerCase();
      console.error("Ripz recording provider status:", JSON.stringify({
        foundVideo: Boolean(videoUid),
        providerState,
        readyToStream: video?.readyToStream === true,
        durationSeconds: Number(video?.duration || 0)
      }));
      if (providerState === "error" || providerState === "failed") {
        const message = clean(video?.status?.errorReasonText || "Cloudflare could not finish processing this recording.", 240);
        await env.DB.prepare("UPDATE ripz_recordings SET recording_status='failed', download_status='failed', error_message=?, updated_at=CURRENT_TIMESTAMP WHERE stream_id=?").bind(message, streamId).run();
        return json({ ok: true, recording_status: "failed", download_status: "failed", message });
      }

      if (providerState !== "ready" && video?.readyToStream !== true) {
        await env.DB.prepare("UPDATE ripz_recordings SET recording_status='processing', updated_at=CURRENT_TIMESTAMP WHERE stream_id=?").bind(streamId).run();
        return json({
          ok: true, recording_status: "processing", download_status: recording.download_status || "pending",
          message: "Your recording is processing. The download button will appear when the MP4 is ready."
        });
      }
      // Only delete a live input after Cloudflare confirms that the retained video
      // has finished processing. Existing recordings remain retained after input deletion.
      const currentRecording = await env.DB.prepare("SELECT input_deleted FROM ripz_recordings WHERE stream_id=?").bind(streamId).first();
      if (videoUid && Number(currentRecording?.input_deleted || 0) === 0) {
        try {
          await streamApi(env, "DELETE", "/live_inputs/" + encodeURIComponent(stream.cloudflare_input_uid));
          await env.DB.prepare("UPDATE ripz_recordings SET input_deleted=1, updated_at=CURRENT_TIMESTAMP WHERE stream_id=?").bind(streamId).run();
        } catch (cleanupError) {
          console.warn("Ripz ended live input cleanup failed:", clean(cleanupError?.message, 180));
        }
      }

      if (Number(video?.duration || 0) >= 4 * 60 * 60) {
        const message = "Cloudflare only provides MP4 downloads for live recordings under four hours. This recording may still be available to replay.";
        await env.DB.prepare("UPDATE ripz_recordings SET recording_status='ready', download_status='unavailable', error_message=?, updated_at=CURRENT_TIMESTAMP WHERE stream_id=?").bind(message, streamId).run();
        return json({ ok: true, recording_status: "ready", download_status: "unavailable", message });
      }

      await env.DB.prepare("UPDATE ripz_recordings SET recording_status='ready', error_message='', updated_at=CURRENT_TIMESTAMP WHERE stream_id=?").bind(streamId).run();

      // Checking for a previously-created download can return an error when there
      // is no MP4 download yet. That must not prevent us from creating one.
      let downloads = null;
      let downloadReadError = null;
      try {
        downloads = await streamApi(env, "GET", "/" + encodeURIComponent(videoUid) + "/downloads");
      } catch (readError) {
        downloadReadError = readError;
        console.info("Ripz MP4 download does not exist yet or is not readable; trying create:", clean(readError?.message, 180));
      }
      if (!downloads?.default?.status) {
        try {
          downloads = await streamApi(env, "POST", "/" + encodeURIComponent(videoUid) + "/downloads");
        } catch (createError) {
          const message = "Your recording is ready, but Cloudflare has not returned an MP4 download yet. Ripz will keep checking; try Check recording status again shortly.";
          console.warn("Ripz MP4 download creation failed:", clean(createError?.message, 180), "after read:", clean(downloadReadError?.message, 180));
          await env.DB.prepare("UPDATE ripz_recordings SET download_status='processing', error_message=?, updated_at=CURRENT_TIMESTAMP WHERE stream_id=?").bind(message, streamId).run();
          return json({
            ok: true, recording_status: "ready", download_status: "processing",
            download_url: null, message
          });
        }
      }

      const download = downloads?.default || null;
      const downloadStatus = String(download?.status || "inprogress").toLowerCase();
      const downloadUrl = clean(download?.url, 2000);
      if (downloadStatus === "error") {
        const statusMessage = "Cloudflare could not generate the MP4 download. Please try checking again; if the problem continues, contact support.";
        await env.DB.prepare("UPDATE ripz_recordings SET download_status='failed', download_url='', error_message=?, updated_at=CURRENT_TIMESTAMP WHERE stream_id=?").bind(statusMessage, streamId).run();
        return json({
          ok: true, recording_status: "ready", download_status: "failed",
          download_url: null, message: statusMessage
        });
      }
      if (downloadStatus === "ready" && downloadUrl) {
        await env.DB.prepare("UPDATE ripz_recordings SET download_status='ready', download_url=?, error_message='', updated_at=CURRENT_TIMESTAMP WHERE stream_id=?").bind(downloadUrl, streamId).run();
        return json({
          ok: true, recording_status: "ready", download_status: "ready",
          download_url: downloadUrl, message: "Your MP4 is ready to download."
        });
      }

      const statusMessage = downloadUrl
        ? "Your recording is ready and Cloudflare is preparing the MP4 download."
        : "Your recording is ready, but Cloudflare has not returned a download link yet. Ripz will keep checking.";
      await env.DB.prepare("UPDATE ripz_recordings SET download_status='processing', download_url=?, error_message=?, updated_at=CURRENT_TIMESTAMP WHERE stream_id=?").bind(
        downloadUrl || "",
        statusMessage,
        streamId
      ).run();
      return json({
        ok: true, recording_status: "ready", download_status: "processing",
        download_url: null, message: statusMessage
      });
    }

    if (action === "end") {
      const streamId = clean(data.stream_id, 100);
      if (!streamId) return json({ ok: false, error: "stream_id_required" }, 400);
      const row = await findOwnedStream(env, streamId);
      if (!row) return json({ ok: true });
      if (Number(row.account_id) !== Number(account.id) && !account.is_admin) return json({ ok: false, error: "not_stream_owner" }, 403);
      if (row.status === "ended") return json({ ok: true, already_ended: true });
      await env.DB.prepare("UPDATE ripz_streams SET status='ended', ended_at=CURRENT_TIMESTAMP, whip_url='', playback_url='', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status<>'ended'").bind(streamId).run();
      // Keep the live input until its recording UID is discoverable. The recording
      // endpoint cleans up the input only after Cloudflare has created a retained video.
      return json({ ok: true, recording_status: "processing" });
    }

    if (action === "chat") {
      const streamId = clean(data.stream_id, 100);
      const message = clean(data.message, 400);
      if (!streamId || message.length < 1) return json({ ok: false, error: "message_required" }, 400);
      const stream = await env.DB.prepare("SELECT id, status FROM ripz_streams WHERE id = ? LIMIT 1").bind(streamId).first();
      if (!stream || stream.status !== "live") return json({ ok: false, error: "stream_not_live" }, 409);
      const previous = await env.DB.prepare("SELECT unixepoch('now') - unixepoch(created_at) AS age_seconds FROM ripz_chat_messages WHERE stream_id=? AND account_id=? ORDER BY id DESC LIMIT 1").bind(streamId, account.id).first();
      if (previous && Number(previous.age_seconds) < 2) return json({ ok: false, error: "chat_rate_limited", message: "Please wait a moment before sending another message." }, 429);
      const result = await env.DB.prepare("INSERT INTO ripz_chat_messages (stream_id, account_id, message) VALUES (?, ?, ?)").bind(streamId, account.id, message).run();
      const row = await env.DB.prepare(`
        SELECT m.id, m.message, m.created_at,
               COALESCE(NULLIF(p.username, ''), NULLIF(a.display_name, ''), 'Collector') AS username
        FROM ripz_chat_messages m JOIN accounts a ON a.id=m.account_id
        LEFT JOIN collector_profiles p ON p.account_id=a.id WHERE m.id=? LIMIT 1
      `).bind(result.meta?.last_row_id).first();
      return json({ ok: true, message: row }, 201);
    }

    return json({ ok: false, error: "unknown_action", message: "This Ripz action is not available in the deployed API version yet." }, 400);
  } catch (error) {
    const safeMessage = clean(error && error.message, 220);
    console.error("Ripz action failed:", safeMessage || "unknown_error");
    return json({
      ok: false,
      error: "ripz_action_failed",
      message: safeMessage
        ? "RIPZ could not complete this step: " + safeMessage
        : "RIPZ could not complete this step. Please try again."
    }, 500);
  }
}
