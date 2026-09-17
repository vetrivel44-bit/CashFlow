/**
 * The service worker exists for one reason: the app must open when the phone
 * has no signal. It caches the shell — the page, the scripts, the icon — and
 * nothing else.
 *
 * It deliberately never caches an /api/ response. The ledger lives in
 * IndexedDB, which the app reads directly; a stale cached API response would
 * be a second, older copy of the truth competing with it.
 */
const CACHE = "cashflow-shell-v1";
const SHELL = [
  "/", "/index.html", "/icon.svg", "/manifest.webmanifest",
  "/src/app.js", "/src/store.js", "/src/sync.js", "/src/i18n.js",
  "/src/drive-backup.js", "/shared/ledger.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) { return; }
  if (url.pathname.startsWith("/api/")) { return; }

  // Network first, so a deployed change is picked up as soon as there is
  // signal; cache second, so the app still opens when there is none.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit ?? caches.match("/index.html")))
  );
});
