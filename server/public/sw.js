// Offline support: the app shell and last-loaded inventory stay available without internet.
// Bump VERSION whenever the list of shell files changes.
const VERSION = 'inventory-v1';
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icons/icon-192.png',
  '/vendor/icons.svg',
  '/vendor/inter-latin.woff2',
  '/vendor/auto-animate.mjs',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const saveCopy = (key, response) => {
  if (response.ok) {
    const copy = response.clone();
    caches.open(VERSION).then(cache => cache.put(key, copy));
  }
  return response;
};

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Fonts, icons, scripts: cache first
  if (url.pathname.startsWith('/vendor/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(caches.match(request).then(hit => hit || fetch(request).then(res => saveCopy(request, res))));
    return;
  }

  // Pages and inventory data: always try the network, fall back to the last copy when offline
  if (request.mode === 'navigate' || url.pathname === '/api/data') {
    const key = request.mode === 'navigate' ? url.pathname : '/api/data';
    event.respondWith(
      fetch(request)
        .then(res => saveCopy(key, res))
        .catch(() => caches.match(key).then(hit => hit || caches.match('/')).then(hit => hit || Response.error()))
    );
  }
});
