const COOKIE = 'collector_session';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

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
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

async function sha256Base64Url(value) {
  return base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function authenticatedAccount(request, env) {
  const token = getCookie(request, COOKIE);
  if (!token) return null;
  const account = await env.DB.prepare(
    'SELECT id, session_expires_at FROM accounts WHERE session_token_hash = ? LIMIT 1'
  ).bind(await sha256Base64Url(token)).first();
  if (!account || !account.session_expires_at || Number(account.session_expires_at) <= Date.now()) return null;
  return account;
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  if (!env.VENDOR_MEDIA) return json({ ok: false, error: 'image_storage_not_configured' }, 503);

  const account = await authenticatedAccount(request, env);
  if (!account) return json({ ok: false, error: 'login_required' }, 401);

  const kind = new URL(request.url).searchParams.get('kind');
  if (!['avatar', 'cover', 'post', 'story'].includes(kind)) return json({ ok: false, error: 'invalid_image_kind' }, 400);

  const contentType = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const extensions = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'video/mp4': 'mp4',
    'video/webm': 'webm'
  };
  const extension = extensions[contentType];
  const isVideo = contentType.startsWith('video/');
  if (!extension || (isVideo && kind !== 'post')) return json({ ok: false, error: 'unsupported_media_type' }, 415);
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) return json({ ok: false, error: isVideo ? 'video_too_large' : 'image_too_large' }, 413);

  try {
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength) return json({ ok: false, error: 'empty_upload' }, 400);
    if (bytes.byteLength > maxBytes) return json({ ok: false, error: isVideo ? 'video_too_large' : 'image_too_large' }, 413);

    const key = 'collectors/' + account.id + '/' + kind + '/' + crypto.randomUUID() + '.' + extension;
    await env.VENDOR_MEDIA.put(key, bytes, {
      httpMetadata: {
        contentType,
        cacheControl: 'public, max-age=31536000, immutable'
      }
    });

    const imageUrl = new URL('/api/vendor/image', request.url);
    imageUrl.searchParams.set('key', key);
    return json({ ok: true, key, url: imageUrl.toString() }, 201);
  } catch (error) {
    console.error('Collector media upload failed:', error);
    return json({ ok: false, error: 'image_upload_failed' }, 500);
  }
}

export async function onRequest() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
