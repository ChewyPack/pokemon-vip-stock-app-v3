import { ensureEventSlugSchema, normalizeEventSlug } from "./_lib/event-slugs.js";

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function absoluteImageUrl(raw, origin) {
  try {
    const url = new URL(String(raw || ""), origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : new URL("/pokeprizepool-pwa-512.png", origin).href;
  } catch {
    return new URL("/pokeprizepool-pwa-512.png", origin).href;
  }
}

function addSocialMetadata(html, event, origin) {
  const title = String(event.title || "Pokémon TCG Event");
  const description = String(event.description || event.details || "Event details from PokePrizePool.").replace(/\s+/g, " ").trim().slice(0, 280);
  const canonicalSlug = normalizeEventSlug(event.slug);
  const canonical = new URL("/" + canonicalSlug, origin).href;
  const image = absoluteImageUrl(event.image_url, origin);
  const tags = [
    '<link rel="canonical" href="' + escapeHtml(canonical) + '">',
    '<meta name="description" content="' + escapeHtml(description) + '">',
    '<meta property="og:type" content="article">',
    '<meta property="og:site_name" content="PokePrizePool">',
    '<meta property="og:title" content="' + escapeHtml(title + " | PokePrizePool") + '">',
    '<meta property="og:description" content="' + escapeHtml(description) + '">',
    '<meta property="og:url" content="' + escapeHtml(canonical) + '">',
    '<meta property="og:image" content="' + escapeHtml(image) + '">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="' + escapeHtml(title + " | PokePrizePool") + '">',
    '<meta name="twitter:description" content="' + escapeHtml(description) + '">',
    '<meta name="twitter:image" content="' + escapeHtml(image) + '">'
  ].join("\n");
  html = html.replace(/<title>[\s\S]*?<\/title>/i, "<title>" + escapeHtml(title + " | PokePrizePool") + "</title>");
  html = html.replace(/<meta\s+name=["']description["'][^>]*>/i, "");
  return html.replace(/<\/head>/i, tags + "\n</head>");
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const rawSlug = String(params.slug || "");
  const slug = normalizeEventSlug(rawSlug);
  if (!slug || !/^[a-z0-9]{2,80}$/.test(slug) || !env.DB || !env.ASSETS) {
    return context.next();
  }

  try {
    if (!await ensureEventSlugSchema(env)) return context.next();
    const event = await env.DB.prepare(
      "SELECT id, title, description, details, event_date, venue, city, state_name, state, url, image_url, badge, status, slug FROM poke_report_events WHERE slug = ? AND status = 'published' LIMIT 1"
    ).bind(slug).first();
    if (!event) return context.next();

    const assetUrl = new URL("/event.html", url.origin);
    const asset = await env.ASSETS.fetch(new Request(assetUrl.toString(), {
      method: "GET",
      headers: request.headers
    }));
    if (!asset.ok) return asset;

    const html = addSocialMetadata(await asset.text(), event, url.origin);
    const headers = new Headers(asset.headers);
    headers.set("content-type", "text/html; charset=utf-8");
    headers.set("cache-control", "no-cache, must-revalidate");
    headers.delete("content-length");
    headers.delete("etag");
    return new Response(request.method === "HEAD" ? null : html, {
      status: asset.status,
      statusText: asset.statusText,
      headers
    });
  } catch (error) {
    console.error("Custom event URL could not be resolved:", error);
    return context.next();
  }
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return context.next();
}
