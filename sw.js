// Bei jeder Änderung an den App-Dateien VERSION erhöhen → iPhone lädt die neue Version.
const VERSION = 'v4.0.1';
const CACHE = `workout-${VERSION}`;
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/logic.js', 'js/charts.js', 'js/sync.js',
  'plans/beispiel.json', 'plans/mein-plan.json', 'plans/library.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' umgeht den Browser-Zwischenspeicher, sonst landen beim Update alte Dateien im neuen Cache
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

// Offline zuerst: aus dem Cache, sonst Netz. Lokal beim Entwickeln: erst Netz, damit Änderungen sofort sichtbar sind.
const DEV = ['localhost', '127.0.0.1'].includes(location.hostname);
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  const cached = () => caches.match(e.request, { ignoreSearch: true });
  // Pläne immer frisch holen (damit Planänderungen sofort ankommen), offline aus dem Cache
  const fresh = DEV || new URL(e.request.url).pathname.includes('/plans/');
  e.respondWith(fresh
    ? fetch(e.request).catch(cached)
    : cached().then((hit) => hit || fetch(e.request)));
});
