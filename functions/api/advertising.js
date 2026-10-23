import { currentChatAccount } from "../_lib/chat.js";

const ALLOWED_SLOTS = new Set([
  "home-top", "home-left", "home-right",
  "chat-top", "chat-inline", "chat-left", "chat-right",
  "events-top", "events-left", "events-right",
  "giveaways-top", "giveaways-left", "giveaways-right"
]);
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function clean(value, max = 500) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function validHttps(value, max = 1200) {
  const raw = clean(value, max);
  if (!raw) return "";
  try { const url = new URL(raw); return url.protocol === "https:" ? url.href : ""; } catch { return ""; }
}
function validAdvertisingImage(value, request) {
  const raw = clean(value, 1200);
  if (!raw) return "";
  try {
    const origin = new URL(request.url).origin;
    const url = new URL(raw, origin);
    const key = url.searchParams.get("key") || "";
    if (url.origin !== origin || url.pathname !== "/api/vendor/image" ||
        !/^advertising\/[a-f0-9-]+\.(jpg|png|webp|avif)$/i.test(key)) return "";
    return "/api/vendor/image?key=" + encodeURIComponent(key);
  } catch { return ""; }
}
async function ensureTables(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS advertising_inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL,
      contact_name TEXT NOT NULL,
      email TEXT NOT NULL,
      website_url TEXT NOT NULL DEFAULT '',
      desired_slot TEXT NOT NULL,
      budget_range TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL DEFAULT '',
      end_date TEXT NOT NULL DEFAULT '',
      destination_url TEXT NOT NULL DEFAULT '',
      creative_url TEXT NOT NULL DEFAULT '',
      campaign_message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','approved','closed')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS advertising_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inquiry_id INTEGER REFERENCES advertising_inquiries(id) ON DELETE SET NULL,
      advertiser_name TEXT NOT NULL,
      headline TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      destination_url TEXT NOT NULL,
      slot TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'paused' CHECK(status IN ('active','paused')),
      created_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ad_campaigns_slot_window ON advertising_campaigns(slot, status, starts_at, ends_at)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ad_inquiries_status_date ON advertising_inquiries(status, created_at)").run();
}
async function requireAdmin(request, env) {
  const account = await currentChatAccount(request, env);
  if (!account) return { response: json({ ok: false, error: "login_required", message: "Sign in with your admin account to manage advertising." }, 401) };
  if (!account.is_admin) return { response: json({ ok: false, error: "admin_required" }, 403) };
  return { account };
}
function publicCampaign(row) {
  if (!row) return null;
  return {
    id: Number(row.id), advertiser_name: String(row.advertiser_name || ""),
    headline: String(row.headline || ""), body: String(row.body || ""),
    image_url: String(row.image_url || ""), destination_url: String(row.destination_url || ""),
    slot: String(row.slot || "")
  };
}
export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "database_not_configured" }, 503);
  try {
    await ensureTables(env);
    const url = new URL(request.url);
    const slot = clean(url.searchParams.get("slot"), 40);
    if (slot) {
      if (!ALLOWED_SLOTS.has(slot)) return json({ ok: false, error: "invalid_slot" }, 400);
      const campaign = await env.DB.prepare(
        "SELECT id, advertiser_name, headline, body, image_url, destination_url, slot FROM advertising_campaigns WHERE slot = ? AND status = 'active' AND starts_at <= CURRENT_TIMESTAMP AND ends_at > CURRENT_TIMESTAMP ORDER BY id DESC LIMIT 1"
      ).bind(slot).first();
      return json({ ok: true, campaign: publicCampaign(campaign) });
    }
    const auth = await requireAdmin(request, env);
    if (auth.response) return auth.response;
    const [inquiries, campaigns] = await Promise.all([
      env.DB.prepare("SELECT * FROM advertising_inquiries ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'contacted' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END, created_at DESC LIMIT 300").all(),
      env.DB.prepare("SELECT c.*, i.company_name AS inquiry_company FROM advertising_campaigns c LEFT JOIN advertising_inquiries i ON i.id = c.inquiry_id ORDER BY c.created_at DESC LIMIT 300").all()
    ]);
    return json({ ok: true, inquiries: inquiries.results || [], campaigns: campaigns.results || [], slots: [...ALLOWED_SLOTS] });
  } catch (error) {
    console.error("Advertising read failed:", error);
    return json({ ok: false, error: "advertising_read_failed" }, 500);
  }
}
export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "database_not_configured" }, 503);
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }
  try {
    await ensureTables(env);
    const action = clean(data?.action, 40);
    if (action === "submit_inquiry") {
      if (clean(data?.fax, 200)) return json({ ok: true, message: "Inquiry received." }, 201);
      const company = clean(data.company_name, 120);
      const contact = clean(data.contact_name, 100);
      const email = clean(data.email, 254).toLowerCase();
      const website = data.website_url ? validHttps(data.website_url, 1200) : "";
      const slot = clean(data.desired_slot, 40);
      const budget = clean(data.budget_range, 40);
      const startDate = clean(data.start_date, 10);
      const endDate = clean(data.end_date, 10);
      const destination = data.destination_url ? validHttps(data.destination_url, 1200) : "";
      const creative = data.creative_url ? validAdvertisingImage(data.creative_url, request) : "";
      const message = clean(data.campaign_message, 3000);
      if (company.length < 2 || contact.length < 2) return json({ ok: false, error: "name_required", message: "Enter your company and contact name." }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: "invalid_email", message: "Enter a valid email address." }, 400);
      if (!ALLOWED_SLOTS.has(slot)) return json({ ok: false, error: "invalid_slot", message: "Choose an available ad placement." }, 400);
      if ((data.website_url && !website) || (data.destination_url && !destination) || (data.creative_url && !creative)) return json({ ok: false, error: "invalid_url", message: "Website, destination, and image links must use HTTPS." }, 400);
      if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return json({ ok: false, error: "invalid_start_date" }, 400);
      if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return json({ ok: false, error: "invalid_end_date" }, 400);
      if (startDate && endDate && endDate < startDate) return json({ ok: false, error: "invalid_date_range", message: "The end date must be on or after the start date." }, 400);
      const recent = await env.DB.prepare("SELECT id FROM advertising_inquiries WHERE LOWER(email) = ? AND created_at >= datetime('now','-10 minutes') LIMIT 1").bind(email).first();
      if (recent) return json({ ok: false, error: "duplicate_recent_inquiry", message: "We recently received an inquiry from this email. Please wait a few minutes before resubmitting." }, 429);
      const result = await env.DB.prepare(
        "INSERT INTO advertising_inquiries (company_name,contact_name,email,website_url,desired_slot,budget_range,start_date,end_date,destination_url,creative_url,campaign_message) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
      ).bind(company,contact,email,website,slot,budget,startDate,endDate,destination,creative,message).run();
      return json({ ok: true, inquiry_id: Number(result.meta?.last_row_id), message: "Your advertising inquiry has been saved. Our team will review the placement, creative, timing, and pricing before taking payment." }, 201);
    }
    const auth = await requireAdmin(request, env);
    if (auth.response) return auth.response;
    if (action === "update_inquiry") {
      const id = Number(data.id);
      const status = clean(data.status, 20);
      if (!Number.isSafeInteger(id) || id < 1 || !["new","contacted","approved","closed"].includes(status)) return json({ ok: false, error: "invalid_inquiry_update" }, 400);
      const result = await env.DB.prepare("UPDATE advertising_inquiries SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(status,id).run();
      if (!result.meta || Number(result.meta.changes) !== 1) return json({ ok: false, error: "inquiry_not_found" }, 404);
      return json({ ok: true });
    }
    if (action === "save_campaign") {
      const id = Number(data.id || 0);
      const inquiryId = data.inquiry_id ? Number(data.inquiry_id) : null;
      const advertiser = clean(data.advertiser_name, 120);
      const headline = clean(data.headline, 100);
      const body = clean(data.body, 300);
      const image = data.image_url ? validAdvertisingImage(data.image_url, request) : "";
      const destination = validHttps(data.destination_url, 1200);
      const slot = clean(data.slot, 40);
      const starts = clean(data.starts_at, 16).replace("T", " ");
      const ends = clean(data.ends_at, 16).replace("T", " ");
      const status = clean(data.status, 12);
      if (!advertiser || !headline || !destination || !ALLOWED_SLOTS.has(slot) ||
          !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(starts) ||
          !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(ends) || ends <= starts ||
          !["active","paused"].includes(status) || (data.image_url && !image) ||
          (inquiryId !== null && (!Number.isSafeInteger(inquiryId) || inquiryId < 1))) {
        return json({ ok: false, error: "invalid_campaign", message: "Check the advertiser, headline, HTTPS destination, placement, schedule, and status." }, 400);
      }
      if (inquiryId !== null) {
        const inquiry = await env.DB.prepare("SELECT id FROM advertising_inquiries WHERE id = ? LIMIT 1").bind(inquiryId).first();
        if (!inquiry) return json({ ok: false, error: "inquiry_not_found" }, 404);
      }
      if (id > 0) {
        await env.DB.prepare("UPDATE advertising_campaigns SET inquiry_id=?,advertiser_name=?,headline=?,body=?,image_url=?,destination_url=?,slot=?,starts_at=?,ends_at=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(inquiryId,advertiser,headline,body,image,destination,slot,starts,ends,status,id).run();
      } else {
        await env.DB.prepare("INSERT INTO advertising_campaigns (inquiry_id,advertiser_name,headline,body,image_url,destination_url,slot,starts_at,ends_at,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
          .bind(inquiryId,advertiser,headline,body,image,destination,slot,starts,ends,status,auth.account.id).run();
      }
      return json({ ok: true });
    }
    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (error) {
    console.error("Advertising request failed:", error);
    return json({ ok: false, error: "advertising_request_failed" }, 500);
  }
}
export async function onRequest() { return json({ ok: false, error: "method_not_allowed" }, 405); }
