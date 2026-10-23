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
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ripz_streams_status_created ON ripz_streams(status, live_at DESC, created_at DESC)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ripz_streams_account_status ON ripz_streams(account_id, status)").run();
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
    status: row.status,
    host: row.host || row.display_name || "Collector",
    created_at: row.created_at,
    live_at: row.live_at || null,
    playback_url: row.playback_url
  };
  if (includePublishUrl) out.whip_url = row.whip_url;
  return out;
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
    console.error("Ripz Stream API request failed:", method, path, response.status);
    throw new Error("stream_provider_error");
  }
  return data.result || {};
}
async function findOwnedStream(env, streamId) {
  return env.DB.prepare(`
    SELECT s.*, COALESCE(NULLIF(p.username, ''), NULLIF(a.display_name, ''), 'Collector') AS host
    FROM ripz_streams s
    JOIN accounts a ON a.id = s.account_id
    LEFT JOIN collector_profiles p ON p.account_id = a.id
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
             COALESCE(NULLIF(p.username, ''), NULLIF(a.display_name, ''), 'Collector') AS host
      FROM ripz_streams s
      JOIN accounts a ON a.id = s.account_id
      LEFT JOIN collector_profiles p ON p.account_id = a.id
      WHERE s.status = 'live'
      ORDER BY COALESCE(s.live_at, s.created_at) DESC
      LIMIT 40
    `).all();
    const myRow = await env.DB.prepare(`
      SELECT s.*, COALESCE(NULLIF(p.username, ''), NULLIF(a.display_name, ''), 'Collector') AS host
      FROM ripz_streams s
      JOIN accounts a ON a.id = s.account_id
      LEFT JOIN collector_profiles p ON p.account_id = a.id
      WHERE s.account_id = ? AND s.status IN ('ready','live')
      ORDER BY s.created_at DESC LIMIT 1
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

    if (action === "start") {
      if (!account.can_go_live) return json({ ok: false, error: "collector_plus_required", message: "Only active Collector+ members can host a Ripz stream." }, 403);
      const title = clean(data.title, 100);
      const productName = clean(data.product_name, 120);
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
          meta: { name: title, app: "PokePrizePool Ripz", product_name: productName, account_id: String(account.id) },
          recording: { mode: "off", requireSignedURLs: false }
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
          INSERT INTO ripz_streams (id, account_id, title, product_name, status, whip_url, playback_url, cloudflare_input_uid)
          VALUES (?, ?, ?, ?, 'ready', ?, ?, ?)
        `).bind(uid, account.id, title, productName, whipUrl, playbackUrl, uid).run();
      } catch (error) {
        streamApi(env, "DELETE", "/live_inputs/" + encodeURIComponent(uid)).catch(() => {});
        throw error;
      }
      const row = await findOwnedStream(env, uid);
      return json({ ok: true, reused: false, stream: streamShape(row, true) }, 201);
    }

    if (action === "publish") {
      if (!account.can_go_live) return json({ ok: false, error: "collector_plus_required" }, 403);
      const streamId = clean(data.stream_id, 100);
      const result = await env.DB.prepare(`
        UPDATE ripz_streams SET status = 'live', live_at = COALESCE(live_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND account_id = ? AND status IN ('ready','live')
      `).bind(streamId, account.id).run();
      if (!result.meta || Number(result.meta.changes || 0) < 1) return json({ ok: false, error: "stream_not_found" }, 404);
      return json({ ok: true });
    }

    if (action === "end") {
      const streamId = clean(data.stream_id, 100);
      if (!streamId) return json({ ok: false, error: "stream_id_required" }, 400);
      const row = await findOwnedStream(env, streamId);
      if (!row) return json({ ok: true });
      if (Number(row.account_id) !== Number(account.id) && !account.is_admin) return json({ ok: false, error: "not_stream_owner" }, 403);
      if (row.status === "ended") return json({ ok: true, already_ended: true });
      await env.DB.prepare("UPDATE ripz_streams SET status='ended', ended_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status<>'ended'").bind(streamId).run();
      let providerStopped = true;
      if (cloudflareConfigured(env)) {
        try {
          await streamApi(env, "PUT", "/live_inputs/" + encodeURIComponent(row.cloudflare_input_uid), { enabled: false });
        } catch (_) { providerStopped = false; }
      } else {
        providerStopped = false;
      }
      return json({ ok: true, provider_stopped: providerStopped, warning: providerStopped ? null : "stream_provider_stop_failed" });
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

    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (error) {
    console.error("Ripz action failed:", error);
    return json({ ok: false, error: "ripz_action_failed", message: "That Ripz action could not be completed. Please try again." }, 500);
  }
}
