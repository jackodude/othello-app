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
  event.waitUntil(
    handlePushNotification(event),
  );
});

async function handlePushNotification(event) {
  const payload = readPushPayload(event);
  const title = typeof payload.title === 'string' ? payload.title : 'Othello';
  const body = typeof payload.body === 'string' ? payload.body : 'Open your game.';
  const data = getNotificationData(payload);
  let appClients = [];
  try {
    appClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
  } catch {
    appClients = [];
  }
  const hasVisibleWindow = appClients.some((client) => {
    try {
      return (
        new URL(client.url).origin === self.location.origin &&
        client.visibilityState === 'visible'
      );
    } catch {
      return false;
    }
  });

  if (hasVisibleWindow) {
    return;
  }

  const options = {
    body,
    data,
  };
  if (typeof payload.icon === 'string') {
    options.icon = payload.icon;
  } else {
    options.icon = '/pwa-icon-192.png';
  }
  if (typeof payload.badge === 'string') {
    options.badge = payload.badge;
  }
  if (typeof payload.tag === 'string') {
    options.tag = payload.tag;
  }

  try {
    await self.registration.showNotification(title, options);
  } catch {
    await self.registration.showNotification(title, { body, data });
  }
}

function readPushPayload(event) {
  try {
    return event.data?.json() ?? {};
  } catch {
    return {};
  }
}

function getNotificationData(payload) {
  if (!payload.data || typeof payload.data !== 'object') {
    return {};
  }

  const data = { ...payload.data };
  if (typeof data.url !== 'string') {
    return data;
  }

  try {
    const url = new URL(data.url, self.location.origin);
    data.url = url.origin === self.location.origin ? `${url.pathname}${url.search}` : '/';
  } catch {
    data.url = '/';
  }

  return data;
}

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
