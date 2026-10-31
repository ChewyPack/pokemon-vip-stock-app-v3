import { currentChatAccount } from "../_lib/chat.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function clean(value, max = 500) { return String(value ?? "").trim().slice(0, max); }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function validEmail(value) { return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function normalizeTier(value) { return String(value || "").trim().toLowerCase().replace(/[_-]/g, " "); }
function active(row) {
  const status = String(row.membership_status || "").toLowerCase();
  const tier = normalizeTier(row.membership_entitlement_tier || row.membership_tier);
  return ["active", "trialing"].includes(status) && !["", "free", "none", "inactive"].includes(tier);
}
async function requireAdmin(request, env) {
  const account = await currentChatAccount(request, env);
  return account?.is_admin ? account : null;
}
async function ensureTables(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS admin_email_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      recipient_count INTEGER NOT NULL DEFAULT 0,
      sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS admin_email_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      account_id INTEGER,
      email TEXT NOT NULL,
      status TEXT NOT NULL,
      resend_id TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_admin_email_recipients_campaign ON admin_email_recipients(campaign_id, status)").run();
}
async function getRecipients(env, search, tier) {
  const pattern = "%" + search + "%";
  const { results = [] } = await env.DB.prepare(`
    SELECT a.id, a.display_name, a.email, a.membership_tier, a.membership_entitlement_tier,
      a.membership_status, p.username
    FROM accounts a
    LEFT JOIN collector_profiles p ON p.account_id = a.id
    WHERE TRIM(COALESCE(a.email,'')) <> ''
      AND (? = '' OR LOWER(COALESCE(a.display_name,'')) LIKE LOWER(?)
        OR LOWER(COALESCE(a.email,'')) LIKE LOWER(?) OR LOWER(COALESCE(p.username,'')) LIKE LOWER(?))
    ORDER BY a.display_name COLLATE NOCASE, a.id
    LIMIT 500
  `).bind(search, pattern, pattern, pattern).all();
  return results.filter(row => {
    const currentTier = normalizeTier(row.membership_entitlement_tier || row.membership_tier);
    if (tier === "collector+") return active(row) && ["collector+", "collector plus"].includes(currentTier);
    if (tier === "vendor+") return active(row) && ["vendor", "vendor+"].includes(currentTier);
    if (tier === "paid") return active(row);
    if (tier === "free") return !active(row);
    return true;
  }).map(row => ({
    id: Number(row.id), display_name: String(row.display_name || "Collector"),
    username: String(row.username || ""), email: String(row.email || ""),
    membership_tier: String(row.membership_entitlement_tier || row.membership_tier || "Free"),
    membership_status: String(row.membership_status || "inactive")
  }));
}
export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "database_not_configured" }, 503);
  if (!(await requireAdmin(request, env))) return json({ ok: false, error: "admin_required" }, 403);
  try {
    await ensureTables(env);
    const url = new URL(request.url);
    if (url.searchParams.get("view") === "history") {
      const campaigns = await env.DB.prepare("SELECT id,subject,recipient_count,sent_count,failed_count,created_at FROM admin_email_campaigns ORDER BY id DESC LIMIT 100").all();
      return json({ ok: true, campaigns: campaigns.results || [] });
    }
    const search = clean(url.searchParams.get("q"), 100);
    const tier = clean(url.searchParams.get("tier"), 20).toLowerCase();
    const recipients = await getRecipients(env, search, tier);
    return json({ ok: true, recipients, count: recipients.length, capped: recipients.length >= 500 });
  } catch (error) {
    console.error("Admin email recipient read failed:", error);
    return json({ ok: false, error: "admin_email_read_failed" }, 500);
  }
}
export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "database_not_configured" }, 503);
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ ok: false, error: "admin_required" }, 403);
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }
  const subject = clean(data?.subject, 180);
  const personalized = Array.isArray(data?.personalized_recipients);
  const template = clean(data?.message_template, 12000);
  const message = clean(data?.message, 12000);
  const ids = Array.isArray(data?.account_ids) ? [...new Set(data.account_ids.map(Number).filter(id => Number.isSafeInteger(id) && id > 0))] : [];
  let recipients = [];
  if (personalized) {
    if (!subject || !template) return json({ ok: false, error: "subject_and_message_required" }, 400);
    if (!data.personalized_recipients.length || data.personalized_recipients.length > 100) return json({ ok: false, error: "select_between_1_and_100_recipients" }, 400);
    recipients = data.personalized_recipients.map((item, index) => ({
      id: null,
      display_name: clean(item?.name, 100),
      email: clean(item?.email, 254),
      amount: clean(item?.amount, 20),
      line: index + 1
    }));
    if (recipients.some(r => !r.display_name || !validEmail(r.email) || !/^\\$?\\d+\\.\\d{2}$/.test(r.amount))) {
      return json({ ok: false, error: "invalid_personalized_recipient", message: "Each row needs a name, valid email, and amount such as 3.20." }, 400);
    }
    const seen = new Set();
    if (recipients.some(r => { const key = r.email.toLowerCase(); if (seen.has(key)) return true; seen.add(key); return false; })) {
      return json({ ok: false, error: "duplicate_recipient_email" }, 400);
    }
  } else {
    if (subject.length < 2 || !message) return json({ ok: false, error: "subject_and_message_required" }, 400);
    if (!ids.length || ids.length > 100) return json({ ok: false, error: "select_between_1_and_100_recipients" }, 400);
  }
  const from = clean(env.RESEND_FROM || env.EMAIL_FROM || env.LINE_SERVICE_FROM || env.PASSWORD_RESET_FROM, 250);
  if (!env.RESEND_API_KEY || !from) return json({ ok: false, error: "resend_not_configured", message: "Resend is not configured for outbound email in this production environment." }, 503);
  try {
    await ensureTables(env);
    if (!personalized) {
      const placeholders = ids.map(() => "?").join(",");
      const result = await env.DB.prepare(`
        SELECT id, display_name, email FROM accounts
        WHERE id IN (${placeholders}) AND TRIM(COALESCE(email,'')) <> ''
      `).bind(...ids).all();
      recipients = (result.results || []).filter(row => validEmail(String(row.email || "").trim())).map(row => ({
        id: Number(row.id), display_name: String(row.display_name || "Collector"),
        email: String(row.email || "").trim(), amount: ""
      }));
    }
    if (!recipients.length) return json({ ok: false, error: "no_valid_recipients" }, 400);
    const campaignMessage = personalized ? template : message;
    const inserted = await env.DB.prepare(
      "INSERT INTO admin_email_campaigns (subject,message,recipient_count,created_by) VALUES (?,?,?,?)"
    ).bind(subject, campaignMessage, recipients.length, admin.id).run();
    const campaignId = Number(inserted.meta?.last_row_id);
    let sent = 0, failed = 0;
    for (const recipient of recipients) {
      const recipientMessage = personalized
        ? template.replaceAll("{{name}}", recipient.display_name).replaceAll("{{amount}}", recipient.amount.replace(/^\\$/, ""))
        : message;
      const paragraphs = recipientMessage.split(/\\n{2,}/).map(part => "<p style=\\"margin:0 0 16px;line-height:1.65\\">" + escapeHtml(part).replace(/\\n/g, "<br>") + "</p>").join("");
      const html = "<!doctype html><html><body style=\\"margin:0;background:#f3f5f8;padding:28px 12px;font-family:Arial,sans-serif;color:#172033\\"><div style=\\"max-width:620px;margin:auto;background:#fff;border-radius:14px;overflow:hidden\\"><div style=\\"background:#0b1730;padding:22px 28px;color:#fff;font-size:20px;font-weight:700\\">PokePrizePool</div><div style=\\"padding:28px\\">" + paragraphs + "<p style=\\"margin-top:28px;color:#667085;font-size:12px\\">You are receiving this message from PokePrizePool.</p></div></div></body></html>";
      let status = "failed", resendId = "", errorText = "";
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [recipient.email], subject, html, text: recipientMessage })
        });
        const responseData = await response.json().catch(() => ({}));
        if (!response.ok) {
          errorText = "Resend rejected email (" + response.status + "): " + clean(responseData.message || responseData.name || "provider_error", 240);
          failed++;
        } else {
          status = "sent"; resendId = clean(responseData.id, 160); sent++;
        }
      } catch (error) {
        errorText = clean(error?.message || "send_failed", 240); failed++;
      }
      await env.DB.prepare("INSERT INTO admin_email_recipients (campaign_id,account_id,email,status,resend_id,error,sent_at) VALUES (?,?,?,?,?,?,CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE NULL END)")
        .bind(campaignId, recipient.id, recipient.email, status, resendId, errorText, status).run();
    }
    await env.DB.prepare("UPDATE admin_email_campaigns SET sent_count=?,failed_count=? WHERE id=?").bind(sent, failed, campaignId).run();
    return json({ ok: true, campaign_id: campaignId, recipients: recipients.length, sent, failed });
  } catch (error) {
    console.error("Admin email send failed:", error);
    return json({ ok: false, error: "admin_email_send_failed" }, 500);
  }
}
export async function onRequest() { return json({ ok: false, error: "method_not_allowed" }, 405); }
