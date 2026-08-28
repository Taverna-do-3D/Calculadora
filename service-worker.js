const CACHE_NAME = 'taverna3d-v1.1.1';
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

async function networkFirst(request, navigationFallback = false) {
  try {
    const fresh = await fetch(request, { cache: 'no-store' });
    if (fresh && fresh.ok) {
      const copy = fresh.clone();
      caches.open(CACHE_NAME).then((c) => c.put(request, copy));
    }
    return fresh;
  } catch (_) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (navigationFallback) {
      const shell = await caches.match('./index.html');
      if (shell) return shell;
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) {
    const copy = fresh.clone();
    caches.open(CACHE_NAME).then((c) => c.put(request, copy));
  }
  return fresh;
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return;
  if (u.pathname.startsWith('/api/')) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(networkFirst(e.request, true));
    return;
  }

  const isAppCode = /\.(?:html|js|css|json)$/i.test(u.pathname) || u.pathname === '/' || u.pathname === '';

  // Código do app sempre tenta a rede primeiro para não deixar JS/HTML antigo preso no PWA.
  if (isAppCode) {
    e.respondWith(networkFirst(e.request, false));
    return;
  }

  // Imagens e demais arquivos estáticos podem continuar cache-first.
  e.respondWith(cacheFirst(e.request));
});
