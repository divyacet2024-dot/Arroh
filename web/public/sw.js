/**
 * MEDORA Service Worker — app-shell caching only.
 *
 * SECURITY / HEALTHCARE RULES:
 *   - Healthcare API responses (/api/v1/*) are NEVER cached here.
 *   - Authentication tokens are NEVER stored in the cache.
 *   - Patient data is NEVER stored in the cache.
 *   - Only static assets that make up the application shell are cached.
 *
 * CACHE STRATEGY:
 *   - App shell (JS, CSS, HTML, fonts, icons): Cache-first with network
 *     fallback. Cached on install; old caches purged on activate.
 *   - API requests (/api/v1/*): Network-only. If the network fails the
 *     fetch error propagates to the application, which handles it.
 *   - Navigation (HTML routes): Network-first with app-shell /index.html
 *     fallback so the SPA can open offline after first load.
 *
 * UPDATE STRATEGY:
 *   - Bump CACHE_VERSION when deploying new assets.
 *   - The SW takes control immediately after skipWaiting().
 *   - The main thread sends 'SKIP_WAITING' to trigger the update.
 *   - Unsynchronized work lives in localStorage/IndexedDB — it is never
 *     in the cache and is therefore safe across SW updates.
 */

const CACHE_VERSION = 'medora-v1';
const SHELL_CACHE   = `${CACHE_VERSION}-shell`;

/**
 * URL prefixes that must NEVER be served from cache.
 * This list is intentionally broad — err on the side of privacy.
 */
const NEVER_CACHE_PREFIXES = [
  '/api/',
  '/auth/',
  'http',   // external origins (fonts.googleapis.com etc. load fine online)
];

/** Static assets to pre-cache during install. */
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/offline.html',
];

// ── Install: pre-cache the application shell ──────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      // Add urls one by one so a single missing asset doesn't abort install
      const results = await Promise.allSettled(
        PRECACHE_URLS.map((url) => cache.add(url))
      );
      const failures = results.filter((r) => r.status === 'rejected');
      if (failures.length > 0) {
        console.warn('[SW] Some precache URLs failed:', failures);
      }
    })
  );
  // Do NOT call skipWaiting() automatically — wait for the main thread
  // to send 'SKIP_WAITING' so we don't interrupt an active session.
});

// ── Activate: delete stale caches ────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE)
          .map((key) => {
            console.info('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      );
      // Take control of all open clients without a reload.
      return self.clients.claim();
    })
  );
});

// ── Message: SKIP_WAITING from the main thread ────────────────────────────

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Fetch: routing strategy ───────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Never intercept non-GET requests (POST/PUT/DELETE go straight to network)
  if (request.method !== 'GET') return;

  // 2. Never cache API or auth calls — let them fail naturally when offline
  if (NEVER_CACHE_PREFIXES.some((prefix) => request.url.includes(prefix))) return;

  // 3. Navigation requests (HTML) — network-first, fallback to /index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .catch(() =>
          caches.match('/index.html').then((cached) => {
            if (cached) return cached;
            return caches.match('/offline.html');
          })
        )
    );
    return;
  }

  // 4. Same-origin static assets — cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          // Only cache successful same-origin responses
          if (response.ok) {
            const clone = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // 5. Everything else — network only (cross-origin fonts, CDN assets, etc.)
  // These work fine when online and gracefully fail when offline.
});
