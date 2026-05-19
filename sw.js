const CACHE_NAME = 'album-amor-v1';
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './icon.svg',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  // Ignorar peticiones a Supabase para que siempre pida los datos frescos
  if (event.request.url.includes('supabase.co')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Devuelve el caché si existe, si no, pide a la red
        return response || fetch(event.request);
      })
  );
});
