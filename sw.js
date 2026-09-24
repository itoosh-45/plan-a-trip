// מטמון האפליקציה. שינוי המספר כאן מפיל את המטמון הישן בהתקנה הבאה.
const CACHE = 'trip-planner-v11';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/tokens.css',
  './css/app.css',
  './fonts/noto-sans-hebrew-hebrew.woff2',
  './fonts/noto-sans-hebrew-latin.woff2',
  './data/prep-catalog.json',
  './vendor/chart.umd.js',
  './vendor/xlsx.full.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './js/app.js',
  './js/db.js',
  './js/ui.js',
  './js/icons.js',
  './js/trips.js',
  './js/itinerary.js',
  './js/expenses.js',
  './js/money.js',
  './js/rates.js',
  './js/currencies.js',
  './js/prep.js',
  './js/catalog.js',
  './js/excel.js',
  './js/backup.js',
  './js/migrate.js',
  './js/onboarding.js',
  './js/screens/prep.js',
  './js/screens/plan.js',
  './js/screens/expenses.js',
  './js/screens/summary.js',
  './js/screens/settings.js',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll נכשל כולו על קובץ אחד חסר. כאן עדיף מטמון חלקי מאשר התקנה שנופלת.
    await Promise.all(SHELL.map(url => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // שערי מטבע נמשכים מהרשת בלבד. לעולם לא מגישים שער מהמטמון כאילו הוא טרי.
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone());
      }
      return response;
    } catch {
      // ניווט בזמן אופליין לקובץ שלא נשמר — מגישים את מעטפת האפליקציה.
      if (request.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      throw new Error('הקובץ אינו זמין אופליין');
    }
  })());
});
