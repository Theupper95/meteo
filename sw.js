// Service worker: l'app si apre anche senza rete, con i file dell'ultima visita.
// Online prende sempre i file nuovi (rete prima, poi copia locale).

const VERSION = 'isobara-3.1.1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/main.js',
  './js/engine.js',
  './js/api.js',
  './js/text.js',
  './js/models.js',
  './js/icons.js',
  './js/chart.js',
  './js/sky.js',
  './js/extras.js',
  './js/alerts.js',
  './js/stations.js',
  './js/radar.js',
  './js/topo.js',
  './js/search.js',
  './data/italia.json',
  './data/comuni.json',
  './vendor/leaflet.js',
  './vendor/leaflet.css',
  './fonts/urbanist.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // le API passano dirette
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      // una richiesta di navigazione non si può ricostruire con opzioni: ne creiamo una semplice
      const netReq = req.mode === 'navigate'
        ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })
        : new Request(req, { cache: 'no-cache' });
      const res = await withTimeout(fetch(netReq), 4000);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});
