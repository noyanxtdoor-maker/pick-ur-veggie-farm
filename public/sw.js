/* PickUrVeggie ERP — minimal service worker (PWA installability + offline shell).
 * Strategy: network-first for navigations (always try fresh HTML, fall back to the cached shell offline);
 * stale-while-revalidate for same-origin GET assets (Vite's hashed JS/CSS cache on first fetch, so a reload
 * works offline). No precache manifest → no build dependency; the app's own data lives in IndexedDB (Dexie).
 * Bump CACHE to invalidate. This is intentionally simple; Workbox/vite-plugin-pwa is the upgrade path if we
 * need precise precaching or push. */
const CACHE = 'puv-shell-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add('/')).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // Navigations: network-first, fall back to the cached app shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(CACHE).then((c) => c.put('/', res.clone()));
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || caches.match(req))),
    );
    return;
  }

  // Assets: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
