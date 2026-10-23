const MAX_BYTES = 5 * 1024 * 1024;
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function originAllowed(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
function extensionFor(type) {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" })[type] || "";
}
function validSignature(type, bytes) {
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (type === "image/webp") return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (type === "image/avif") {
    const probe = String.fromCharCode(...bytes.slice(0, 48));
    return probe.includes("ftyp") && (probe.includes("avif") || probe.includes("avis"));
  }
  return false;
}
async function ensureLimitTable(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS advertising_upload_limits (
      ip_hash TEXT NOT NULL,
      hour_bucket INTEGER NOT NULL,
      uploads INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (ip_hash, hour_bucket)
    )
  `).run();
}
async function applyUploadLimit(request, env) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return false;
  await ensureLimitTable(env);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  const hash = Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, "0")).join("");
  const bucket = Math.floor(Date.now() / 3600000);
  await env.DB.prepare("INSERT INTO advertising_upload_limits (ip_hash,hour_bucket,uploads) VALUES (?,?,1) ON CONFLICT(ip_hash,hour_bucket) DO UPDATE SET uploads=uploads+1").bind(hash,bucket).run();
  const row = await env.DB.prepare("SELECT uploads FROM advertising_upload_limits WHERE ip_hash=? AND hour_bucket=?").bind(hash,bucket).first();
  await env.DB.prepare("DELETE FROM advertising_upload_limits WHERE hour_bucket < ?").bind(bucket-24).run();
  return Number(row?.uploads || 0) <= 5;
}
export async function onRequestPost({ request, env }) {
  if (!env.VENDOR_MEDIA) return json({ ok: false, error: "image_storage_not_configured", message: "Advertising image storage is not configured yet." }, 503);
  if (!originAllowed(request)) return json({ ok: false, error: "origin_not_allowed" }, 403);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BYTES + 1024 * 1024) return json({ ok: false, error: "image_too_large", message: "Choose an image smaller than 5 MB." }, 413);
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function" || !file.size) return json({ ok: false, error: "file_required", message: "Choose an image file to upload." }, 400);
    if (file.size > MAX_BYTES) return json({ ok: false, error: "image_too_large", message: "Choose an image smaller than 5 MB." }, 413);
    const type = String(file.type || "").toLowerCase().split(";")[0];
    const ext = extensionFor(type);
    if (!ext) return json({ ok: false, error: "unsupported_image_type", message: "Upload a JPG, PNG, WebP, or AVIF image." }, 415);
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (!validSignature(type, bytes)) return json({ ok: false, error: "invalid_image_file", message: "The file content does not match a supported image." }, 415);
    if (env.DB && !await applyUploadLimit(request, env)) return json({ ok: false, error: "upload_limit_reached", message: "This connection has reached the limit of five advertising image uploads per hour." }, 429);
    const key = "advertising/" + crypto.randomUUID() + "." + ext;
    await env.VENDOR_MEDIA.put(key, buffer, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
    return json({ ok: true, image_url: "/api/vendor/image?key=" + encodeURIComponent(key), message: "Image uploaded." }, 201);
  } catch (error) {
    console.error("Advertising image upload failed:", error);
    return json({ ok: false, error: "image_upload_failed", message: "The image could not be uploaded. Please try again." }, 500);
  }
}
export async function onRequest() { return json({ ok: false, error: "method_not_allowed" }, 405); }
