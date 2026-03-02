const CACHE_VERSION = 'one21-v5';
const CACHE_NAME = 'one21-static-' + CACHE_VERSION;

// Only pre-cache static assets — HTML pages use network-first (see fetch handler)
const ASSETS = [
  '/css/design-system.css',
  '/manifest.json',
  '/logo.png',
  '/css/layers/pages/index.css',
  '/css/layers/pages/login.css',
  '/css/layers/pages/join.css',
  '/css/layers/pages/chat.css',
  '/css/layers/pages/admin.css',
];

// HTML navigation routes — always fetch from network, cache as fallback only
const HTML_ROUTES = ['/one21/', '/one21/join', '/one21/chat', '/one21/hey', '/admin.html'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) {
            return k.startsWith('one21-static-') && k !== CACHE_NAME;
          })
          .map(function (k) {
            return caches.delete(k);
          })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (e) {
  // Never intercept API calls
  if (e.request.url.indexOf('/api/') !== -1) return;

  const url = new URL(e.request.url);

  // HTML pages: network-first — always show fresh content, fall back to cache only if offline
  if (e.request.mode === 'navigate' || HTML_ROUTES.some(function (r) { return url.pathname === r; })) {
    e.respondWith(
      fetch(e.request).then(function (response) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(e.request, clone); });
        return response;
      }).catch(function () {
        return caches.match(e.request);
      })
    );
    return;
  }

  // JS files — never cache in SW; let browser HTTP cache handle them
  if (url.pathname.endsWith('.js')) return;

  // Static assets: cache-first (CSS, images, fonts)
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      return cached || fetch(e.request).then(function (response) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(e.request, clone); });
        return response;
      });
    })
  );
});
