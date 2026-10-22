'use strict';

const SHELL_CACHE = 'pokeprizepool-shell-v1';
const CORE_NAVIGATION = new Set([
  '/', '/index.html', '/account.html', '/collector.html',
  '/chat.html', '/events.html', '/marketplace.html', '/vendor.html'
]);
const CORE_ASSETS = [
  '/offline.html',
  '/assets/pwa-icon-192.svg',
  '/assets/pwa-icon-512.svg'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(CORE_ASSETS.map(url => cache.add(url).catch(error => {
      console.warn('Could not precache PWA asset:', url, error);
    })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('pokeprizepool-shell-') && key !== SHELL_CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

// Cache only static app shells. API responses, membership-protected content, and
// user-specific data are deliberately never placed in the offline cache.
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !CORE_NAVIGATION.has(url.pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    try {
      const response = await fetch(request);
      if (response && response.ok && (response.headers.get('content-type') || '').includes('text/html')) {
        await cache.put(url.pathname, response.clone());
      }
      return response;
    } catch (_) {
      return (await cache.match(url.pathname)) ||
        (await cache.match('/offline.html')) ||
        new Response('PokePrizePool is offline. Reconnect and try again.', {
          status: 503,
          headers: { 'content-type': 'text/plain; charset=utf-8' }
        });
    }
  })());
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  const title = String(data.title || 'PokePrizePool alert');
  const options = {
    body: String(data.body || 'There is a new update for collectors.'),
    icon: '/assets/pwa-icon-192.svg',
    badge: '/assets/pwa-icon-192.svg',
    tag: String(data.tag || 'pokeprizepool-alert'),
    renotify: false,
    data: { url: String(data.url || '/notifications.html') }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(
    String(event.notification.data && event.notification.data.url || '/notifications.html'),
    self.location.origin
  );
  if (target.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(target.href);
        return client.focus();
      }
    }
    return self.clients.openWindow(target.href);
  })());
});
