/* Umair TikTok Wala Academy — Service Worker
   Strategy: network-first for everything (so students always get fresh
   lessons/data), fall back to cache only when offline. This avoids the
   classic PWA problem of serving stale pages after an update. */

const CACHE = 'utw-cache-v1';

// Files that are safe to pre-cache (the shell). We keep this small.
const PRECACHE = [
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).catch(() => {})
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;

  // Only handle GET; let everything else (POST to /api, Firebase, etc.) pass through untouched.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never touch API calls, Firebase, Google, YouTube, analytics — always live.
  const liveOnly = [
    '/api/', 'firestore', 'firebaseio', 'googleapis', 'gstatic',
    'google.com', 'youtube.com', 'ytimg', 'gvt1', 'identitytoolkit',
    'securetoken', 'sheets', 'script.google'
  ];
  if (liveOnly.some((s) => url.href.includes(s))) return;

  // Network-first: try the network, cache a copy, fall back to cache if offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        // cache same-origin successful responses only
        if (res && res.status === 200 && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || caches.match('/learn.html'))
      )
  );
});
