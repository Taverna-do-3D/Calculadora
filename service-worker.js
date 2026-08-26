const CACHE_NAME = 'taverna3d-v1.0.0';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/taverna-logo.png',
  './assets/taverna-192.png',
  './assets/taverna-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k.startsWith('taverna3d-') && k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          if (r && r.ok) {
            const cp = r.clone();
            caches.open(CACHE_NAME).then((c) => c.put(e.request, cp));
          }
          return r;
        })
        .catch(async () => (await caches.match(e.request)) || (await caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => {
      return (
        cached ||
        fetch(e.request).then((r) => {
          if (r && r.ok) {
            const cp = r.clone();
            caches.open(CACHE_NAME).then((c) => c.put(e.request, cp));
          }
          return r;
        })
      );
    })
  );
});
