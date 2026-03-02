const CACHE_VERSION = 'one21-v2';
const CACHE_NAME = 'one21-static-' + CACHE_VERSION;

const ASSETS = [
  '/one21/',
  '/one21/join',
  '/one21/chat',
  '/one21/hey',
  '/admin.html',
  '/css/design-system.css',
  '/manifest.json',
  '/logo.png',
  '/css/layers/pages/index.css',
  '/css/layers/pages/login.css',
  '/css/layers/pages/join.css',
  '/css/layers/pages/chat.css',
  '/css/layers/pages/admin.css',
];

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
  if (e.request.url.indexOf('/api/') !== -1) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      return cached || fetch(e.request);
    })
  );
});
