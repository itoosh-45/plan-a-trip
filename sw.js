// Emergency Safari recovery worker.
// It deliberately does not touch IndexedDB or localStorage. It only replaces
// the broken application-shell cache that contained redirected responses.
const CACHE_PREFIXES = ['trip-planner-shell-', 'trip-planner-v'];

function cleanResponse(response) {
  if (!response.redirected) return response;
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

self.addEventListener('install', event => {
  // Do not precache during recovery: one redirected shell response must never
  // be able to make installation fail.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (CACHE_PREFIXES.some(prefix => key.startsWith(prefix))) {
        await caches.delete(key);
      }
    }
    await self.clients.claim();
    for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
      client.postMessage({ type: 'sw-updated' });
    }
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    let response = await fetch(request);

    // Safari refuses a Response with redirected=true when it is returned by a
    // service worker. Resolve the final same-origin URL and construct a fresh
    // response so redirected is false.
    if (response.redirected) {
      const finalUrl = new URL(response.url);
      if (finalUrl.origin !== self.location.origin) return cleanResponse(response);
      response = await fetch(new Request(finalUrl.href, {
        method: 'GET',
        headers: request.headers,
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'follow',
      }));
    }

    return cleanResponse(response);
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'APPLY_UPDATE') self.skipWaiting();
});
