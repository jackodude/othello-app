const CACHE_NAME = 'othello-shell-v1';
const SHELL_URLS = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/pwa-icon-192.png',
  '/pwa-icon-512.png',
  '/pwa-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => cacheName !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/')),
    );
  }
});

self.addEventListener('push', (event) => {
  const payload = event.data?.json() ?? {};
  const title = typeof payload.title === 'string' ? payload.title : 'Othello';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const hasVisibleWindow = clients.some(
          (client) => client.visibilityState === 'visible',
        );

        if (hasVisibleWindow) {
          return undefined;
        }

        return self.registration.showNotification(title, {
          body: typeof payload.body === 'string' ? payload.body : 'Open your game.',
          icon: typeof payload.icon === 'string' ? payload.icon : '/pwa-icon-192.png',
          badge: typeof payload.badge === 'string' ? payload.badge : '/pwa-icon-192.png',
          tag: typeof payload.tag === 'string' ? payload.tag : undefined,
          data: payload.data && typeof payload.data === 'object' ? payload.data : {},
        });
      })
      .catch(() =>
        self.registration.showNotification(title, {
          body: typeof payload.body === 'string' ? payload.body : 'Open your game.',
          icon: typeof payload.icon === 'string' ? payload.icon : '/pwa-icon-192.png',
          badge: typeof payload.badge === 'string' ? payload.badge : '/pwa-icon-192.png',
          tag: typeof payload.tag === 'string' ? payload.tag : undefined,
          data: payload.data && typeof payload.data === 'object' ? payload.data : {},
        }),
      ),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin);

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === targetUrl.origin && 'focus' in client) {
          client.navigate(targetUrl.href);
          return client.focus();
        }
      }

      return self.clients.openWindow(targetUrl.href);
    }),
  );
});
