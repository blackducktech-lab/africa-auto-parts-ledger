const CACHE = 'export-ledger-__BUILD_ID__';
const SHELL = ['./', './index.html', './assets/styles.css', './assets/app.js', './assets/sync-core.js', './assets/cloud.js', './assets/sync-ui.js', './assets/icon.svg', './manifest.webmanifest'];
const scopePath = new URL(self.registration.scope).pathname;
// Different GitHub Pages projects on one origin must never delete each other's caches.
const CACHE_PREFIX = 'export-ledger-' + scopePath + '-';
const CACHE_NAME = CACHE_PREFIX + CACHE;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(scopePath)) return;
  // Only the public app shell is cached. Cloud records and login requests are cross-origin and never cached here.
  event.respondWith(caches.match(event.request, { cacheName: CACHE_NAME }).then(hit => hit || fetch(event.request)));
});
