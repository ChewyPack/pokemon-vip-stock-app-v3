import { currentChatAccount } from "../_lib/chat.js";

const DESTINATION = "pokeprizepool@gmail.com";
const MAX_TEXT = 6000;
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function clean(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function validEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
async function sendNotice(env, row) {
  const from = clean(env.LINE_SERVICE_FROM || env.PASSWORD_RESET_FROM, 250);
  if (!env.RESEND_API_KEY || !from) return { sent: false, error: "email_not_configured" };
  const subject = "New PokePrizePool line-service request #" + row.id;
  const html = "<h2>New line-service request #" + row.id + "</h2><p>This is an inquiry, not a confirmed reservation.</p><pre style=\"font:14px/1.5 Arial,sans-serif;white-space:pre-wrap\">" + escapeHtml(row.summary) + "</pre><p>Review it in <a href=\"https://pokeprizepool.com/admin.html\">PokePrizePool Admin</a>.</p>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [DESTINATION], subject, html, text: row.summary + "\n\nReview in PokePrizePool Admin: https://pokeprizepool.com/admin.html" })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("Line-service notification failed:", response.status, detail.slice(0, 300));
    return { sent: false, error: "email_provider_rejected_" + response.status };
  }
  return { sent: true, error: "" };
}
async function sendAndRecord(env, row) {
  const result = await sendNotice(env, row);
  await env.DB.prepare("UPDATE line_service_requests SET email_status = ?, email_error = ?, email_sent_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE email_sent_at END WHERE id = ?")
    .bind(result.sent ? "sent" : "failed", result.error, result.sent ? 1 : 0, row.id).run();
  return result;
}
async function getAdmin(request, env) {
  try {
    const account = await currentChatAccount(request, env);
    return account && account.is_admin ? account : null;
  } catch {
    return null;
  }
}
function requestRow(data) {
  return {
    name: clean(data.name, 160),
    discord: clean(data.discord, 120),
    email: clean(data.email, 254).toLowerCase(),
    tier: clean(data.tier, 20),
    store: clean(data.store, 200),
    address: clean(data.address, 500),
    request_date: clean(data.request_date, 20),
    opening_time: clean(data.opening_time, 20),
    release: clean(data.release, 300),
    service_type: clean(data.service_type, 20),
    duration_mode: clean(data.duration_mode, 20),
    hours: clean(data.hours, 20),
    products: clean(data.products, 3000),
    quantities: clean(data.quantities, 1000),
    budget: clean(data.budget, 30),
    notes: clean(data.notes, 2000),
    estimated_fee: clean(data.estimated_fee, 80),
    summary: clean(data.summary, MAX_TEXT)
  };
}
function validate(d) {
  if (!d.name || !d.discord || !validEmail(d.email) || !d.store || !d.address || !d.request_date || !d.release || !d.products || !d.quantities || !d.summary) return "required_fields_missing";
  if (!["member", "vip"].includes(d.tier) || !["std", "high"].includes(d.service_type) || !["hourly", "pkg"].includes(d.duration_mode)) return "invalid_selection";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.request_date) || d.request_date < new Date().toISOString().slice(0, 10)) return "invalid_request_date";
  if (d.duration_mode === "hourly" && (!Number.isInteger(Number(d.hours)) || Number(d.hours) < 3 || Number(d.hours) > 24)) return "invalid_duration";
  if (d.budget && (!Number.isFinite(Number(d.budget)) || Number(d.budget) < 0 || Number(d.budget) > 10000000)) return "invalid_budget";
  return "";
}
export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "database_not_configured" }, 500);
  if (!(await getAdmin(request, env))) return json({ ok: false, error: "admin_required" }, 403);
  try {
    const result = await env.DB.prepare("SELECT id,name,discord,email,tier,store,address,request_date,opening_time,release,service_type,duration_mode,hours,products,quantities,budget,notes,estimated_fee,summary,status,email_status,email_error,email_sent_at,created_at FROM line_service_requests ORDER BY created_at DESC LIMIT 300").all();
    return json({ ok: true, requests: result.results || [] });
  } catch (error) {
    console.error("Line-service admin list failed:", error);
    return json({ ok: false, error: "line_service_requests_unavailable" }, 500);
  }
}
export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "database_not_configured" }, 500);
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }
  if (data && data.action === "resend_email") {
    if (!(await getAdmin(request, env))) return json({ ok: false, error: "admin_required" }, 403);
    const id = Number(data.id);
    if (!Number.isSafeInteger(id) || id < 1) return json({ ok: false, error: "invalid_request_id" }, 400);
    try {
      const row = await env.DB.prepare("SELECT id,summary FROM line_service_requests WHERE id = ?").bind(id).first();
      if (!row) return json({ ok: false, error: "request_not_found" }, 404);
      const result = await sendAndRecord(env, row);
      return json({ ok: result.sent, email_sent: result.sent, error: result.error || null }, result.sent ? 200 : 503);
    } catch (error) {
      console.error("Line-service email retry failed:", error);
      return json({ ok: false, error: "email_retry_failed" }, 500);
    }
  }
  const d = requestRow(data || {});
  if (clean(data.website, 200)) return json({ ok: true, request_received: true }, 202);
  const invalid = validate(d);
  if (invalid) return json({ ok: false, error: invalid }, 400);
  try {
    const inserted = await env.DB.prepare("INSERT INTO line_service_requests (name,discord,email,tier,store,address,request_date,opening_time,release,service_type,duration_mode,hours,products,quantities,budget,notes,estimated_fee,summary) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(d.name,d.discord,d.email,d.tier,d.store,d.address,d.request_date,d.opening_time,d.release,d.service_type,d.duration_mode,d.hours,d.products,d.quantities,d.budget,d.notes,d.estimated_fee,d.summary).run();
    const id = Number(inserted.meta?.last_row_id);
    const row = { id, summary: d.summary };
    const notice = await sendAndRecord(env, row);
    return json({ ok: true, id, request_received: true, email_sent: notice.sent, email_error: notice.sent ? null : notice.error }, 201);
  } catch (error) {
    console.error("Line-service request save failed:", error);
    return json({ ok: false, error: "line_service_submission_failed" }, 500);
  }
}
export async function onRequest() {
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
