// Trip Planner service worker — offline app shell + map-tile caching.
//
// Road trips through places like the Norwegian fjords often have no signal
// (a running theme across this app's other features — printable itinerary,
// GPX export). This makes the app shell and previously-viewed map tiles
// available with no network at all, without weakening index.html's
// deliberate `Cache-Control: no-store` (see aws/handler.mjs) — that header
// exists so a normal online visit always gets the live app, since this
// project is under active development. The service worker respects that:
// it's network-first for the shell, falling back to its own cache only when
// there truly is no network. Bump the cache names below when the caching
// strategy itself changes in a way that needs old entries discarded —
// activate() deletes any cache name not listed in KEEP.
const SHELL_CACHE = 'tripplan-shell-v1';
const TILE_CACHE = 'tripplan-tiles-v1';
const KEEP = [SHELL_CACHE, TILE_CACHE];

const SHELL_URLS = [
  '/',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_URLS))
      // Don't fail install over one unreachable CDN asset (e.g. this
      // sandbox's dev environment has no CDN access at all) — whatever did
      // cache still helps, and the network-first fetch handler covers the
      // rest on the next successful online load.
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(n => !KEEP.includes(n)).map(n => caches.delete(n)))
    )
  );
  self.clients.claim();
});

function isTileRequest(url) {
  return /(^|\.)tile\.openstreetmap\.org$/.test(url.hostname);
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Map tiles: cache-first. They almost never change, and this is the
  // actual point — areas of the map already looked at while online stay
  // visible later with no connection.
  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async cache => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch (e) {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // App shell: this page plus Leaflet's CDN bundle. Network-first, cache as
  // fallback — never the other way around, so online visits always run the
  // live code. Every navigation is treated as a request for '/' regardless
  // of the exact URL requested (this is a single-page app), matching how
  // SHELL_URLS precaches it at install time.
  const isNavigate = req.mode === 'navigate';
  const isShellAsset = SHELL_URLS.includes(req.url);
  if (!isNavigate && !isShellAsset) return;
  const key = isNavigate ? '/' : req;

  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.put(key, copy)));
        }
        return res;
      })
      .catch(() =>
        caches.open(SHELL_CACHE)
          .then(cache => cache.match(key))
          .then(cached => cached || Response.error())
      )
  );
});
