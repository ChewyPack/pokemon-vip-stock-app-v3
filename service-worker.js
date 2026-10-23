'use strict';

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  const title = String(data.title || 'PokePrizePool alert');
  const options = {
    body: String(data.body || 'There is a new update for collectors.'),
    icon: '/inbox-icon.png',
    badge: '/inbox-icon.png',
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
