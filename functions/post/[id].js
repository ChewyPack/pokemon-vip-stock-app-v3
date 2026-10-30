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
    return url.protocol === "https:" ? url.href : fallback;
  } catch {
    return fallback;
  }
}

function addPostMetadata(html, post, origin) {
  const username = String(post.username || "collector");
  const author = String(post.display_name || username);
  const title = author + " shared a post | PokePrizePool";
  const body = String(post.body || "").replace(/\\s+/g, " ").trim();
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
  ].join("\\n");
  html = html.replace(/<title>[\\s\\S]*?<\\/title>/i, "<title>" + escapeHtml(title) + "</title>");
  html = html.replace(/<meta\\s+name=["']description["'][^>]*>/i, "");
  return html.replace(/<\\/head>/i, tags + "\\n</head>");
}

function postPageShell() {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="theme-color" content="#071326">',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link href="https://fonts.googleapis.com/css2?family=Bangers&family=Nunito:wght@500;600;700;800;900&display=swap" rel="stylesheet">',
    '<link rel="stylesheet" href="/css/styles.css">',
    '<link rel="manifest" href="/manifest.webmanifest">',
    '<title>Collector Post | PokePrizePool</title>',
    '<style>',
    ':root{--social-navy:#071326;--social-blue:#102b52;--social-yellow:#ffd21f;--social-muted:#9aacc8;--social-line:#263d60}',
    'html{background:#050d1b}body{margin:0;background:radial-gradient(ellipse at 50% 0%,#142d52 0%,#08162b 48%,#050d1b 100%)!important;color:#eef4ff!important;min-height:100vh;font-family:Nunito,system-ui,sans-serif}',
    '.community-wrap{width:min(900px,calc(100% - 28px));margin:30px auto 80px}',
    '.community-heading{background:linear-gradient(115deg,#10284b,#0b1b35 62%,#142e54);border:1px solid #29466d;border-radius:18px;padding:24px clamp(20px,4vw,36px);margin-bottom:18px;box-shadow:0 18px 50px #0005}',
    '.community-heading .eyebrow{margin:0 0 6px;color:#ffd21f;font-size:.72rem;letter-spacing:.15em;font-weight:900;text-transform:uppercase}',
    '.community-heading h1{font-size:clamp(1.7rem,5vw,2.4rem);margin:0;color:#fff;letter-spacing:-.04em}',
    '.community-heading p{color:#c1cee2;margin:8px 0 0;line-height:1.55}',
    '.social-inline-status{font-size:.84rem;color:#9fb2d0;margin:8px 0}',
    '.social-post{background:linear-gradient(145deg,#101f38,#0c192e)!important;border:1px solid #293f61!important;border-radius:17px!important;padding:19px!important;box-shadow:0 10px 30px #0003!important;margin-bottom:16px!important;color:#eef4ff!important;min-width:0}',
    '.social-post-header{display:flex;align-items:center;gap:10px;min-width:0}.social-avatar{width:44px;height:44px;flex:0 0 44px;object-fit:cover;border-radius:50%;border:2px solid #385477;background:#172b49}.social-avatar-placeholder{display:grid;place-items:center;color:#ffd21f;font-weight:900}',
    '.social-post-author{flex:1;min-width:0}.social-post-author>a{font-weight:900;color:#f3f7ff;text-decoration:none;overflow-wrap:anywhere}.social-post-author div{font-size:.79rem;color:#9aacc8;overflow-wrap:anywhere}.social-post-author div a{color:#9aacc8;text-decoration:none}',
    '.social-post-menu{position:relative;margin-left:auto;align-self:flex-start}.social-post-menu-trigger{width:34px;height:34px;border:0;border-radius:50%;background:transparent;color:#9aacc8;font-size:25px;cursor:pointer}.social-post-menu-items{position:absolute;z-index:20;right:0;top:36px;min-width:145px;padding:5px;background:#101f38;border:1px solid #344d70;border-radius:10px;box-shadow:0 8px 24px #0006}.social-post-menu-items[hidden]{display:none!important}.social-post-menu-items button{display:block;width:100%;padding:9px;border:0;border-radius:7px;background:transparent;color:#e8effb;text-align:left;font:inherit;cursor:pointer}',
    '.social-post-body{color:#e5edf9;line-height:1.7;overflow-wrap:anywhere;white-space:normal;margin:15px 0}.social-post-media-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0}.social-post-media-grid.is-single{grid-template-columns:minmax(0,1fr)}.social-post-media-item{min-width:0;overflow:hidden;border-radius:12px;background:#071326}.social-post-media-item .social-post-image,.social-post-video{display:block;width:100%;height:100%;max-height:560px;object-fit:contain;background:#071326;border-radius:12px;margin:0}.social-post-video{aspect-ratio:16/9;min-height:150px}',
    '.social-post-stats{display:flex;gap:14px;flex-wrap:wrap;color:#9aacc8;font-size:.82rem;padding:12px 0;border-bottom:1px solid #293f61}.social-stat-button{border:0;background:transparent;color:#9aacc8;font:inherit;font-size:.82rem;cursor:pointer;text-decoration:underline;text-underline-offset:3px}.social-view-count{color:#9aacc8;font-size:.82rem}',
    '.social-post-actions{display:flex;gap:8px;flex-wrap:wrap;padding-top:12px}.social-post-actions button{background:#172b49;color:#dce8fa;border:1px solid #2b4365;border-radius:9px;padding:9px 13px;font:800 .84rem Nunito,system-ui,sans-serif;cursor:pointer}.social-post-actions button:disabled{opacity:.6;cursor:wait}.social-share-status{margin:6px 0 0;color:#9aacc8;font-size:.78rem;min-height:1em}',
    '.social-comments{margin-top:10px;padding-top:10px;border-top:1px solid #293f61}.social-comments[hidden],.social-likers-thread[hidden]{display:none!important}.social-comment-list,.social-likers-list{display:grid;gap:10px}.social-comment{display:flex;align-items:flex-start;gap:8px;min-width:0}.social-comment-avatar,.social-liker-avatar{width:32px;height:32px;flex:0 0 32px;border-radius:50%;object-fit:cover;background:#172b49}.social-comment-content{flex:1;min-width:0;background:#172b49;color:#e5edf9;border-radius:10px;padding:9px 11px}.social-comment-content div{font-size:.82rem}.social-comment-content div a{color:#fff;font-weight:900;text-decoration:none}.social-comment-content div span{color:#9aacc8}.social-comment-content p{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0 0;line-height:1.5}.social-comment-form{display:flex;gap:8px;align-items:flex-end;margin-top:10px}.social-comment-form textarea{min-width:0;flex:1;border:1px solid #344d70;border-radius:9px;padding:9px;font:inherit;background:#08162a;color:#fff;resize:vertical}.social-comment-form button{border:0;border-radius:8px;background:#ffd21f;color:#09172b;padding:10px 13px;font:900 .85rem Nunito,system-ui,sans-serif;cursor:pointer}',
    '.social-likers-thread{margin:8px 0;padding:11px;border:1px solid #293f61;border-radius:10px;background:#0b1930}.social-liker{display:flex;align-items:center;gap:9px;min-width:0;padding:6px;border-radius:8px;background:#172b49;color:#fff}.social-liker-name{min-width:0;overflow-wrap:anywhere}.social-liker-name a{color:#fff;text-decoration:none;font-weight:900}.social-liker-name span{display:block;color:#9aacc8;font-size:.78rem}',
    '.social-empty-state{display:grid;gap:6px;text-align:center;padding:30px 16px;background:#101f38;border:1px dashed #385477;border-radius:14px;color:#a9bad4}.social-empty-state strong{color:#fff}.social-inline-status{color:#9fb2d0!important}.social-post-permalink{color:inherit;text-decoration:none}.social-post-permalink:hover{text-decoration:underline;text-underline-offset:3px}',
    '.social-reaction-options{display:flex;gap:5px;flex-wrap:wrap}.social-reaction-options[hidden]{display:none!important}.social-reaction-options button{padding:5px 8px!important}',
    '.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}',
    '@media(max-width:640px){.community-wrap{width:calc(100% - 20px);margin:16px auto 48px}.social-post{padding:14px!important;border-radius:14px!important}.social-post-actions button{flex:1;padding:9px 7px!important}.social-post-header{gap:9px}.social-post-media-grid{gap:6px}.social-comment-form{flex-wrap:wrap}}',
    '</style>',
    '</head>',
    '<body>',
    '<div id="site-navigation"></div>',
    '<main class="community-wrap">',
    '<header class="community-heading"><p class="eyebrow">Collector community</p><h1>Community Post</h1><p>View this collector post and join the conversation on PokePrizePool.</p></header>',
    '<section id="community-feed" class="social-single-post-view">',
    '<p class="social-inline-status" data-social-feed-status role="status" aria-live="polite">Loading post…</p>',
    '<div data-social-post-list></div>',
    '</section>',
    '</main>',
    '<script src="/js/ui/collector-social.js?v=20261030-shareable-post-links-2"></script>',
    '<script src="/js/ui/site-nav.js?v=20261028-live-profile-rings-v1"></script>',
    '</body>',
    '</html>'
  ].join("\\n");
}

export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url);
  const rawId = String(params.id || "");
  if (!/^[1-9][0-9]{0,15}$/.test(rawId)) {
    return new Response("Post not found.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (!env.DB) {
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

    const html = addPostMetadata(postPageShell(), post, url.origin);
    return new Response(request.method === "HEAD" ? null : html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=60"
      }
    });
  } catch (error) {
    console.error("Collector post permalink could not be resolved:", error);
    return new Response("This post link could not be loaded right now.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
    });
  }
}

export async function onRequestHead(context) {
  return onRequestGet(context);
}

export async function onRequest() {
  return new Response("Method not allowed.", { status: 405, headers: { "content-type": "text/plain; charset=utf-8" } });
}
