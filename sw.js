/* Sixer service worker — offline-first cache. */
const CACHE = 'sixer-v4';
const ASSETS = [
  './', './index.html',
  './css/styles.css',
  './js/store.js', './js/scoring.js', './js/stats.js', './js/charts.js', './js/photo.js', './js/ui.js', './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
/* Network-first with a short timeout, falling back to cache.
   Keeps the app fully usable offline (on the ground, no signal) while making
   sure a deployed update is picked up on the next load instead of being
   pinned to a stale cache. */
const NET_TIMEOUT = 3000;

function networkFirst(request) {
  return new Promise((resolve) => {
    let settled = false;
    const fallback = () => caches.match(request).then((cached) => cached || caches.match('./index.html'));

    const timer = setTimeout(() => {
      if (settled) return;
      fallback().then((cached) => { if (cached && !settled) { settled = true; resolve(cached); } });
    }, NET_TIMEOUT);

    fetch(request).then((res) => {
      clearTimeout(timer);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
      }
      if (!settled) { settled = true; resolve(res); }
    }).catch(() => {
      clearTimeout(timer);
      fallback().then((cached) => {
        if (settled) return;
        settled = true;
        resolve(cached || new Response('Offline', { status: 503, statusText: 'Offline' }));
      });
    });
  });
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // let cross-origin pass through
  e.respondWith(networkFirst(e.request));
});
