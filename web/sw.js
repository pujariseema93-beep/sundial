// Cache the shell so the app opens offline. Nothing else is cached and no
// request ever leaves for a Sundial server, because there isn't one.

const CACHE = 'sundial-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icon.svg',
  './app/main.js',
  './app/store.js',
  './app/format.js',
  './app/template.js',
  './app/insight.js',
  './app/demo.js',
  './engine/index.js',
  './engine/model.js',
  './engine/util.js',
  './engine/intervals.js',
  './engine/sessions.js',
  './engine/metrics.js',
  './engine/detectors.js',
  './engine/facts.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // fonts and API calls go straight to the network

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        }),
    ),
  );
});
