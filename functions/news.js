// Production share page handler. Social crawlers request HTML without running client-side JavaScript,
// so this route injects per-story Open Graph/Twitter metadata into the actual response.
function escaped(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function publishedImage(story) {
  let images = [];
  try {
    const parsed = JSON.parse(story.image_urls_json || '[]');
    if (Array.isArray(parsed)) images = parsed;
  } catch (_) {}
  const selected = images.find(value => typeof value === 'string' && value.trim()) || story.image_url || '';
  try {
    const url = new URL(String(selected).trim(), 'https://pokeprizepool.com');
    return url.protocol === 'https:' ? url.href : '';
  } catch (_) {
    return '';
  }
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const slug = String(url.searchParams.get('story') || '').trim().slice(0, 100);
  const response = await context.next();
  if (!slug || !context.env.DB || !response.ok) return response;

  try {
    const story = await context.env.DB.prepare(
      "SELECT slug, title, excerpt, image_url, image_urls_json FROM poke_report_stories WHERE slug = ? AND status = 'published' LIMIT 1"
    ).bind(slug).first();
    if (!story) return response;

    const image = publishedImage(story);
    if (!image) return response;
    const title = String(story.title || 'PokePrizePool News').trim().slice(0, 180);
    const description = String(story.excerpt || '').replace(/\\s+/g, ' ').trim().slice(0, 400) || title;
    const canonical = 'https://pokeprizepool.com/news?story=' + encodeURIComponent(story.slug);
    const meta = [
      '<meta property="og:type" content="article">',
      '<meta property="og:site_name" content="PokePrizePool">',
      '<meta property="og:title" content="' + escaped(title) + '">',
      '<meta property="og:description" content="' + escaped(description) + '">',
      '<meta property="og:url" content="' + escaped(canonical) + '">',
      '<meta property="og:image" content="' + escaped(image) + '">',
      '<meta property="og:image:secure_url" content="' + escaped(image) + '">',
      '<meta property="og:image:alt" content="' + escaped(title) + '">',
      '<meta name="twitter:card" content="summary_large_image">',
      '<meta name="twitter:title" content="' + escaped(title) + '">',
      '<meta name="twitter:description" content="' + escaped(description) + '">',
      '<meta name="twitter:image" content="' + escaped(image) + '">',
      '<link rel="canonical" href="' + escaped(canonical) + '">'
    ].join('\\n  ');

    let html = await response.text();
    html = html.replace(/<title>[\\s\\S]*?<\\/title>/i, '<title>' + escaped(title) + ' | PokePrizePool</title>');
    html = html.replace(/<meta\\b[^>]*\\bname=["']description["'][^>]*>/i,
      '<meta name="description" content="' + escaped(description) + '">');
    html = html.replace(/<meta\\b[^>]*\\bproperty=["']og:[^"']+["'][^>]*>/gi, '');
    html = html.replace(/<meta\\b[^>]*\\bname=["']twitter:[^"']+["'][^>]*>/gi, '');
    html = html.replace(/<link\\b[^>]*\\brel=["']canonical["'][^>]*>/gi, '');
    html = html.replace(/<\\/head>/i, '  ' + meta + '\\n</head>');

    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.delete('etag');
    headers.delete('last-modified');
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store');
    return new Response(html, { status: response.status, statusText: response.statusText, headers });
  } catch (error) {
    console.error('Poke Report share-page rendering failed:', error);
    return response;
  }
}
