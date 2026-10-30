function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function absoluteImageUrl(raw, origin) {
  const fallback = new URL("/pokeprizepool-pwa-512.png", origin).href;
  if (!raw) return fallback;
  let media;
  try {
    const parsed = JSON.parse(String(raw));
    media = Array.isArray(parsed) ? parsed : [];
  } catch {
    media = [{ type: "image", url: String(raw) }];
  }
  const image = media.find(item => item && item.type === "image" && typeof item.url === "string" && item.url.trim());
  if (!image) return fallback;
  try {
    const url = new URL(image.url, origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : fallback;
  } catch {
    return fallback;
  }
}

function addPostMetadata(html, post, origin) {
  const username = String(post.username || "collector");
  const author = String(post.display_name || username);
  const title = author + " shared a post | PokePrizePool";
  const body = String(post.body || "").replace(/\s+/g, " ").trim();
  const description = (body || "See this collector post on PokePrizePool.").slice(0, 260);
  const canonical = new URL("/post/" + Number(post.id), origin).href;
  const image = absoluteImageUrl(post.image_url, origin);
  const tags = [
    '<link rel="canonical" href="' + escapeHtml(canonical) + '">',
    '<meta name="description" content="' + escapeHtml(description) + '">',
    '<meta property="og:type" content="article">',
    '<meta property="og:site_name" content="PokePrizePool">',
    '<meta property="og:title" content="' + escapeHtml(title) + '">',
    '<meta property="og:description" content="' + escapeHtml(description) + '">',
    '<meta property="og:url" content="' + escapeHtml(canonical) + '">',
    '<meta property="og:image" content="' + escapeHtml(image) + '">',
    '<meta property="og:image:alt" content="' + escapeHtml("Post shared by " + author) + '">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="' + escapeHtml(title) + '">',
    '<meta name="twitter:description" content="' + escapeHtml(description) + '">',
    '<meta name="twitter:image" content="' + escapeHtml(image) + '">'
  ].join("\n");
  html = html.replace(/<title>[\s\S]*?<\/title>/i, "<title>" + escapeHtml(title) + "</title>");
  html = html.replace(/<meta\s+name=["']description["'][^>]*>/i, "");
  return html.replace(/<\/head>/i, tags + "\n</head>");
}

export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url);
  const rawId = String(params.id || "");
  if (!/^[1-9][0-9]{0,15}$/.test(rawId)) {
    return new Response("Post not found.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (!env.DB || !env.ASSETS) {
    return new Response("Post links are temporarily unavailable.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  try {
    const post = await env.DB.prepare(
      "SELECT p.id, p.body, p.image_url, cp.username, a.display_name " +
      "FROM collector_posts p " +
      "JOIN collector_profiles cp ON cp.account_id = p.account_id " +
      "JOIN accounts a ON a.id = p.account_id " +
      "WHERE p.id = ? AND p.deleted_at IS NULL AND cp.is_public = 1 LIMIT 1"
    ).bind(Number(rawId)).first();

    if (!post) {
      return new Response("This post is unavailable or is no longer public.", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
      });
    }

    const assetUrl = new URL("/newsfeed.html", url.origin);
    const asset = await env.ASSETS.fetch(new Request(assetUrl.toString(), {
      method: "GET",
      headers: request.headers
    }));
    if (!asset.ok) return asset;

    const html = addPostMetadata(await asset.text(), post, url.origin);
    const headers = new Headers(asset.headers);
    headers.set("content-type", "text/html; charset=utf-8");
    headers.set("cache-control", "public, max-age=60, s-maxage=300, stale-while-revalidate=60");
    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.delete("etag");
    return new Response(html, { status: asset.status, statusText: asset.statusText, headers });
  } catch (error) {
    console.error("Collector post permalink could not be resolved:", error);
    return new Response("This post link could not be loaded right now.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
    });
  }
}

export async function onRequestHead(context) {
  const response = await onRequestGet(context);
  return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
}

export async function onRequest() {
  return new Response("Method not allowed.", { status: 405, headers: { "content-type": "text/plain; charset=utf-8" } });
}
