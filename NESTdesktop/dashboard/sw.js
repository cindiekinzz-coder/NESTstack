/**
 * NESTeq Service Worker — The Nest PWA
 * Caches the shell for offline access, always fetches chat live
 */

const CACHE_NAME = 'nest-v1';
const SHELL = [
  '/chat.html',
  '/index.html',
  '/css/styles.css',
  '/js/chat.js',
  '/js/api.js',
  '/assets/images/companion-default.png',
  '/assets/images/ember.svg',
  '/manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Never cache API calls — always go live
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/v1/') || url.hostname.includes('workers.dev')) {
    return;
  }

  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
