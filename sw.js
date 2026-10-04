// מטמון האפליקציה. שינוי המספר כאן מפיל את המטמון הישן בהתקנה הבאה.
const CACHE = 'trip-planner-shell-20261004-preview-2';

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
  './js/daterange.js',
  './js/trips.js',
  './js/itinerary.js',
  './js/segment-display.js',
  './js/expenses.js',
  './js/money.js',
  './js/budgets.js',
  './js/rates.js',
  './js/currencies.js',
  './js/prep.js',
  './js/catalog.js',
  './js/imported.js',
  './js/excel.js',
  './js/backup.js',
  './js/migrate.js',
  './js/onboarding.js',
  './js/welcome.js',
  './js/sheets.js',
  './js/sheets-setup.js',
  './js/screens/no-trip.js',
  './js/screens/prep.js',
  './js/screens/plan.js',
  './js/screens/expenses.js',
  './js/screens/summary.js',
  './js/screens/settings.js',
  './js/updates.js',
  './js/maps/store.js',
  './js/maps/packages.js',
  './js/maps/search.js',
  './js/maps/render.js',
  './js/screens/map.js',
  './css/map.css',
  './vendor/maplibre-gl.js',
  './vendor/maplibre-gl.css',
  './vendor/pmtiles.js',
  './data/map-packages.json',
  './data/world-map-packages.json',
  './img/welcome/catalog-pick.webp',
  './img/welcome/date-range.webp',
  './img/welcome/expense-add.webp',
  './img/welcome/plan-days.webp',
  './img/welcome/plan-segments.webp',
  './img/welcome/prep-list.webp',
  './img/welcome/summary-budget.webp',
  './img/welcome/wizard-step1.webp',
];

async function fetchForCache(url) {
  const request = new Request(url, { cache: 'reload' });
  let response = await fetch(request);

  // Safari refuses to serve a cached Response whose redirected flag is true.
  // Cloudflare Assets may canonicalize paths such as /index.html to /, so
  // normalize those responses before they ever enter Cache Storage.
  if (response.redirected) {
    const finalUrl = new URL(response.url);
    if (finalUrl.origin !== self.location.origin) {
      throw new Error('Refusing cross-origin redirected shell asset: ' + finalUrl.href);
    }
    response = await fetch(new Request(finalUrl.href, { cache: 'reload', credentials: 'same-origin' }));
  }

  if (!response.ok || response.redirected) {
    throw new Error('Shell asset is not cacheable without redirects: ' + request.url);
  }

  return new Response(await response.arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function withoutRedirectFlag(response) {
  if (!response || !response.redirected) return response;
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      for (const url of SHELL) {
        const request = new Request(url, { cache: 'reload' });
        await cache.put(request, await fetchForCache(url));
      }
      // Emergency compatibility release: the broken Safari page cannot press
      // the normal in-app update button. Activating this worker does not touch
      // IndexedDB/localStorage or reload an active page by itself.
      await self.skipWaiting();
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })());
});

/**
 * החלפת גרסה. הדף שפתוח באותו רגע נטען מהמטמון הישן, ולכן אחרי שהמטמון
 * הוחלף צריך לטעון אותו מחדש — אחרת המשתמש ממשיך לראות את הגרסה הקודמת עד
 * הפעם הבאה שהוא סוגר ופותח את האפליקציה, ולפעמים גם אז.
 *
 * קיומו של מטמון ישן הוא ההבדל בין עדכון להתקנה ראשונה: בהתקנה ראשונה הדף
 * זה עתה נטען מהרשת, ואין שום סיבה לרענן אותו.
 */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const stale = (await caches.keys()).filter(key => key !== CACHE && /^trip-planner-(?:shell-|v\d+$)/.test(key));
    for (const key of stale) await caches.delete(key);
    await self.clients.claim();
    if (!stale.length) return;

    // ההודעה, ולא client.navigate: ניווט יזום מה-SW סוגר את החלון בחלק
    // מהדפדפנים, וחלון שנסגר גרוע בהרבה מגרסה ישנה. הדף מרענן את עצמו,
    // וברגע שנוח לו — לא באמצע הקלדה ולא כשחלון פתוח.
    for (const client of await self.clients.matchAll({ type: 'window' })) {
      client.postMessage({ type: 'sw-updated' });
    }
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Download chunks are stored in the map database; never duplicate them in the shell cache.
  if (url.pathname.includes('/map-packages/') || url.pathname.includes('/api/')) return;
  // שערי מטבע נמשכים מהרשת בלבד. לעולם לא מגישים שער מהמטמון כאילו הוא טרי.
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    // An in-flight request handled by the previous worker can recreate its
    // cache after activation. Read only this release, never another cache.
    const cache = await caches.open(CACHE);
    const cached = request.mode === 'navigate'
      ? await cache.match('./index.html')
      : await cache.match(request, { ignoreSearch: true });
    if (cached) return withoutRedirectFlag(cached);
    try {
      const response = await fetch(request);
      if (response.ok && !response.redirected) {
        cache.put(request, response.clone());
      }
      // Safari blocks service-worker responses that carry the redirected flag.
      // Never cache such a response, and strip the flag before returning it.
      return withoutRedirectFlag(response);
    } catch {
      // ניווט בזמן אופליין לקובץ שלא נשמר — מגישים את מעטפת האפליקציה.
      if (request.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw new Error('הקובץ אינו זמין אופליין');
    }
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'APPLY_UPDATE') self.skipWaiting();
});
