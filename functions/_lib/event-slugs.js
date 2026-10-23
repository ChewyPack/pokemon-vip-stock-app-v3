const RESERVED_EVENT_SLUGS = new Set([
  "event", "api", "assets", "css", "js", "resources", "newsfeed",
  "marketplace", "collector", "chat", "giveaways", "events", "news",
  "account", "alerts", "vendor", "store", "shop", "updates",
  "notifications", "inbox", "messages", "wishlist", "submit-event",
  "instant-buyout", "instant-cash-out", "market-intelligence"
]);

export function normalizeEventSlug(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 80);
}

export function eventSlugFromTitle(value) {
  return normalizeEventSlug(value);
}

export function isReservedEventSlug(value) {
  return RESERVED_EVENT_SLUGS.has(normalizeEventSlug(value));
}

async function availableSlug(env, base, excludeId, used) {
  const root = normalizeEventSlug(base) || "event";
  let candidate = root;
  let suffix = 2;
  while (RESERVED_EVENT_SLUGS.has(candidate) || (used && used.has(candidate))) {
    candidate = (root + String(suffix++)).slice(0, 80);
  }
  while (true) {
    const existing = await env.DB.prepare(
      "SELECT id FROM poke_report_events WHERE slug = ? AND id <> ? LIMIT 1"
    ).bind(candidate, Number(excludeId || 0)).first();
    if (!existing && !(used && used.has(candidate))) return candidate;
    candidate = (root + String(suffix++)).slice(0, 80);
  }
}

export async function uniqueEventSlug(env, requestedSlug, title, excludeId = 0) {
  const desired = normalizeEventSlug(requestedSlug || title);
  if (!desired) return { error: "event_slug_required" };
  if (isReservedEventSlug(desired)) return { error: "event_slug_reserved" };
  const existing = await env.DB.prepare(
    "SELECT id FROM poke_report_events WHERE slug = ? AND id <> ? LIMIT 1"
  ).bind(desired, Number(excludeId || 0)).first();
  if (existing) return { error: "event_slug_in_use" };
  return { slug: desired };
}

export async function ensureEventSlugSchema(env) {
  if (!env.DB) return false;
  const table = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'poke_report_events' LIMIT 1"
  ).first();
  if (!table) return false;

  const columns = await env.DB.prepare("PRAGMA table_info(poke_report_events)").all();
  const names = new Set((columns.results || []).map(column => column.name));
  if (!names.has("slug")) {
    try {
      await env.DB.prepare("ALTER TABLE poke_report_events ADD COLUMN slug TEXT NOT NULL DEFAULT ''").run();
    } catch (error) {
      if (!String(error && error.message || "").toLowerCase().includes("duplicate column")) throw error;
    }
  }
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_poke_report_events_slug ON poke_report_events(slug)").run();

  const rows = await env.DB.prepare("SELECT id, title, slug FROM poke_report_events ORDER BY id ASC").all();
  const allRows = rows.results || [];
  const used = new Set(allRows.map(row => normalizeEventSlug(row.slug)).filter(Boolean));
  for (const row of allRows) {
    if (normalizeEventSlug(row.slug)) continue;
    const base = eventSlugFromTitle(row.title) || "event" + String(row.id);
    const slug = await availableSlug(env, base, Number(row.id), used);
    await env.DB.prepare(
      "UPDATE poke_report_events SET slug = ? WHERE id = ? AND (slug IS NULL OR slug = '')"
    ).bind(slug, row.id).run();
    used.add(slug);
  }
  return true;
}
