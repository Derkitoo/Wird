const CACHE_NAME = 'wird-app-shell-v34';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './api.js',
  './quranData.js',
  './tafsirFr.json',
  './icon.jpg',
  './manifest.json'
];

// Install Event - Pre-cache App Shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching App Shell...');
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate Event - Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event - Stale-While-Revalidate + Audio Cache Interception
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // Intercept audio CDN files and look up in wird-audio-cache
  if (url.includes('cdn.alquran.cloud') || url.includes('audio.qurancdn.com')) {
    event.respondWith(
      caches.open('wird-audio-cache').then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Fetch from network normally if not cached
          return fetch(event.request);
        });
      })
    );
    return;
  }

  // Handle local app shell files - Network First strategy. cache: 'no-store'
  // makes this an actual network-first fetch — without it, the browser's own
  // HTTP cache can quietly serve a heuristically-cached response here even
  // though the strategy is meant to always prefer fresh network content,
  // defeating the point of bumping CACHE_NAME on deploy.
  if (url.startsWith(self.location.origin)) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline fallback
          return caches.match(event.request);
        })
    );
  }
});
