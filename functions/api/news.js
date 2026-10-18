const COOKIE = 'collector_session';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function getCookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const value = part.trim();
    if (value.startsWith(name + '=')) return value.slice(name.length + 1);
  }
  return '';
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .split('+').join('-').split('/').join('_').replace(/=+$/, '');
}

async function sha256(value) {
  return base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function ensureTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS poke_report_stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    excerpt TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'News',
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
    published_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_poke_report_stories_status_date ON poke_report_stories(status, published_at DESC)').run();
}

async function currentAccount(request, env) {
  const token = getCookie(request, COOKIE);
  if (!token) return null;
  const hash = await sha256(token);
  const account = await env.DB.prepare(
    'SELECT id, display_name, email, is_admin, session_expires_at FROM accounts WHERE session_token_hash = ? LIMIT 1'
  ).bind(hash).first();
  if (!account || !account.session_expires_at || Number(account.session_expires_at) <= Date.now()) return null;
  return account;
}

async function requireAdmin(request, env) {
  const account = await currentAccount(request, env);
  if (!account) return { error: json({ ok: false, error: 'login_required' }, 401) };
  if (Number(account.is_admin || 0) !== 1) return { error: json({ ok: false, error: 'admin_required' }, 403) };
  return { account };
}

function makeSlug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  try {
    await ensureTable(env);
    const url = new URL(request.url);
    const storySlug = cleanText(url.searchParams.get('slug') || '', 100);
    const adminView = url.searchParams.get('admin') === '1';

    if (adminView) {
      const access = await requireAdmin(request, env);
      if (access.error) return access.error;
      const rows = await env.DB.prepare(
        'SELECT id, slug, title, excerpt, content, image_url, category, status, published_at, created_at, updated_at FROM poke_report_stories ORDER BY updated_at DESC, id DESC LIMIT 200'
      ).all();
      return json({ ok: true, stories: rows.results || [] });
    }

    if (storySlug) {
      const story = await env.DB.prepare(
        'SELECT slug, title, excerpt, content, image_url, category, published_at FROM poke_report_stories WHERE slug = ? AND status = \'published\' LIMIT 1'
      ).bind(storySlug).first();
      if (!story) return json({ ok: false, error: 'story_not_found' }, 404);
      return json({ ok: true, story });
    }

    const categoryFilter = cleanText(url.searchParams.get('category') || '', 40);
    let rows;
    if (['News', 'Updates', 'Market Intelligence', 'Events'].includes(categoryFilter)) {
      rows = await env.DB.prepare(
        'SELECT slug, title, excerpt, image_url, category, published_at FROM poke_report_stories WHERE status = \'published\' AND category = ? ORDER BY published_at DESC, id DESC LIMIT 100'
      ).bind(categoryFilter).all();
    } else {
      rows = await env.DB.prepare(
        'SELECT slug, title, excerpt, image_url, category, published_at FROM poke_report_stories WHERE status = \'published\' ORDER BY published_at DESC, id DESC LIMIT 100'
      ).all();
    }
    return json({ ok: true, stories: rows.results || [] });
  } catch (error) {
    console.error('Poke Report story read failed:', error);
    return json({ ok: false, error: 'news_read_failed' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  const access = await requireAdmin(request, env);
  if (access.error) return access.error;
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'bad_request' }, 400); }

  const id = Number(data.id || 0);
  const title = cleanText(data.title, 180);
  const excerpt = cleanText(data.excerpt, 500);
  const content = cleanText(data.content, 30000);
  const category = cleanText(data.category, 40) || 'News';
  const imageUrl = cleanText(data.image_url, 1000);
  const status = data.status === 'published' ? 'published' : 'draft';
  let slug = makeSlug(data.slug || title);

  if (!title) return json({ ok: false, error: 'title_required' }, 400);
  if (!content) return json({ ok: false, error: 'content_required' }, 400);
  if (!slug) return json({ ok: false, error: 'valid_slug_required' }, 400);
  if (!['News', 'Updates', 'Market Intelligence', 'Events'].includes(category)) return json({ ok: false, error: 'invalid_category' }, 400);
  if (imageUrl && !imageUrl.toLowerCase().startsWith('https://')) return json({ ok: false, error: 'image_must_use_https_url' }, 400);

  try {
    await ensureTable(env);
    const existing = id ? await env.DB.prepare('SELECT id, published_at FROM poke_report_stories WHERE id = ? LIMIT 1').bind(id).first() : null;
    if (id && !existing) return json({ ok: false, error: 'story_not_found' }, 404);
    const publishedAt = status === 'published' ? (existing?.published_at || new Date().toISOString()) : null;
    if (existing) {
      await env.DB.prepare(
        'UPDATE poke_report_stories SET slug=?, title=?, excerpt=?, content=?, image_url=?, category=?, status=?, published_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
      ).bind(slug, title, excerpt, content, imageUrl, category, status, publishedAt, id).run();
    } else {
      await env.DB.prepare(
        'INSERT INTO poke_report_stories (slug,title,excerpt,content,image_url,category,status,published_at) VALUES (?,?,?,?,?,?,?,?)'
      ).bind(slug, title, excerpt, content, imageUrl, category, status, publishedAt).run();
    }
    const saved = await env.DB.prepare(
      'SELECT id, slug, title, excerpt, content, image_url, category, status, published_at, created_at, updated_at FROM poke_report_stories WHERE slug = ? LIMIT 1'
    ).bind(slug).first();
    return json({ ok: true, story: saved });
  } catch (error) {
    if (String(error && error.message || '').toLowerCase().includes('unique')) return json({ ok: false, error: 'slug_already_used' }, 409);
    console.error('Poke Report story save failed:', error);
    return json({ ok: false, error: 'news_save_failed' }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  const access = await requireAdmin(request, env);
  if (access.error) return access.error;
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isSafeInteger(id) || id < 1) return json({ ok: false, error: 'valid_story_id_required' }, 400);
  try {
    await ensureTable(env);
    const result = await env.DB.prepare('DELETE FROM poke_report_stories WHERE id = ?').bind(id).run();
    if (!result.meta || result.meta.changes !== 1) return json({ ok: false, error: 'story_not_found' }, 404);
    return json({ ok: true });
  } catch (error) {
    console.error('Poke Report story delete failed:', error);
    return json({ ok: false, error: 'news_delete_failed' }, 500);
  }
}

export async function onRequest() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
