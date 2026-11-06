const CACHE = 'linguify-static-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Purge every other cache, including earlier ones that may hold the old public answer banks.
    for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});
// Own static assets only (Lottie, sounds, images). CDN fetches would be blocked by the CSP connect-src,
// and pages, site scripts and /api always hit the network.
const cacheable = url => url.origin === self.location.origin && url.pathname.startsWith('/assets/');
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range') || !cacheable(new URL(request.url))) return;
  // Stale-while-revalidate: instant from cache, refreshed in the background for the next visit.
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(request);
    const fresh = fetch(request).then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    });
    if (cached) { event.waitUntil(fresh.catch(() => {})); return cached; }
    return fresh;
  }));
});
