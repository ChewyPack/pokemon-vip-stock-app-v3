
const SESSION_COOKIE = "vip_session";
const SESSION_DAYS = 30;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function redirect(url, cookie) {
  const headers = { Location: url };

  if (cookie) {
    headers["Set-Cookie"] = cookie;
  }

  return new Response(null, {
    status: 302,
    headers
  });
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256(value) {
  return crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
}

function sessionCookie(token, expiresAt) {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`
  ].join("; ");
}

function discordAuthorizationUrl(env, state) {
  const redirectUri =
    String(env.DISCORD_REDIRECT_URI || "").trim();

  if (!redirectUri) {
    throw new Error("DISCORD_REDIRECT_URI is missing");
  }

  const parsed = new URL(redirectUri);

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "pokeprizepool.com" ||
    parsed.pathname !== "/api/discord/callback" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Invalid Discord redirect URI");
  }

  const params = new URLSearchParams({
    client_id: String(env.DISCORD_CLIENT_ID || "").trim(),
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "identify",
    state
  });

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const rawToken = url.searchParams.get("token") || "";

    if (!/^[A-Za-z0-9_-]{40,50}$/.test(rawToken)) {
      return redirect("/#discord-recovery-error");
    }

    const tokenHash = base64Url(await sha256(rawToken));

    const link = await env.DB.prepare(
      `SELECT id, user_id, expires_at, used_at
       FROM vip_recovery_links
       WHERE token_hash = ?
       LIMIT 1`
    ).bind(tokenHash).first();

    if (
      !link ||
      link.used_at ||
      Number(link.expires_at) < Date.now()
    ) {
      return redirect("/#discord-recovery-error");
    }

    const member = await env.DB.prepare(
      `SELECT id, membership_status
       FROM users
       WHERE id = ?
       LIMIT 1`
    ).bind(link.user_id).first();

    if (!member || member.membership_status !== "active") {
      return redirect("/#discord-recovery-error");
    }

    /*
     * Atomically consume the link so it cannot be used twice.
     */
    const consumed = await env.DB.prepare(
      `UPDATE vip_recovery_links
       SET used_at = ?
       WHERE id = ?
         AND used_at IS NULL
         AND expires_at >= ?`
    ).bind(Date.now(), link.id, Date.now()).run();

    if (!consumed.success || consumed.meta?.changes !== 1) {
      return redirect("/#discord-recovery-error");
    }

    /*
     * Create a new browser session for this existing member.
     */
    const sessionToken = base64Url(
      crypto.getRandomValues(new Uint8Array(32))
    );

    const sessionHash = base64Url(
      await sha256(sessionToken)
    );

    const sessionExpiresAt =
      Date.now() + SESSION_DAYS * 86400000;

    const sessionResult = await env.DB.prepare(
      `UPDATE users
       SET session_token_hash = ?,
           session_expires_at = ?
       WHERE id = ?
         AND membership_status = 'active'`
    ).bind(
      sessionHash,
      sessionExpiresAt,
      member.id
    ).run();

    if (
      !sessionResult.success ||
      sessionResult.meta?.changes !== 1
    ) {
      throw new Error("Could not create VIP session");
    }

    /*
     * Store a fresh OAuth state for the normal callback.
     */
    const state = base64Url(
      crypto.getRandomValues(new Uint8Array(32))
    );

    const stateExpiresAt = Date.now() + 10 * 60 * 1000;

    await env.DB.prepare(
      `UPDATE users
       SET discord_oauth_state = ?,
           discord_oauth_state_expires_at = ?
       WHERE id = ?
         AND membership_status = 'active'`
    ).bind(
      state,
      stateExpiresAt,
      member.id
    ).run();

    return redirect(
      discordAuthorizationUrl(env, state),
      sessionCookie(sessionToken, sessionExpiresAt)
    );
  } catch (error) {
    console.error(
      "Discord recovery failed:",
      error instanceof Error ? error.message : "Unknown error"
    );

    return redirect("/#discord-recovery-error");
  }
}
