// Network-first for same-origin files: online -> fresh copy (and cache it); offline -> cache.
// Bump CACHE_VERSION at every step so old caches are dropped.
const CACHE_VERSION = "elh-v4";

const APP_SHELL = [
  "./",
  "index.html",
  "manifest.json",
  "css/tokens.css",
  "css/base.css",
  "css/layout.css",
  "css/components.css",
  "css/practice.css",
  "css/vocab.css",
  "js/app.js",
  "js/router.js",
  "js/views/placeholder.js",
  "js/views/dashboard.js",
  "js/views/practice.js",
  "js/views/practice-detail.js",
  "js/views/practice-forms.js",
  "js/views/practice-notebooks.js",
  "js/views/vocab.js",
  "js/views/vocab-detail.js",
  "js/components/quick-capture.js",
  "js/components/speech.js",
  "js/components/download.js",
  "js/components/dom.js",
  "js/components/overlay.js",
  "js/components/toast.js",
  "js/components/modal.js",
  "js/components/sheet.js",
  "js/components/band-cell.js",
  "js/components/backup-ui.js",
  "js/services/schema.js",
  "js/services/dedupe.js",
  "js/services/db.js",
  "js/services/repo.js",
  "js/services/merge.js",
  "js/services/backup.js",
  "js/services/bands.js",
  "js/services/progress.js",
  "js/services/next-test.js",
  "js/services/practice-store.js",
  "js/services/capture.js",
  "js/services/vocab-ops.js",
  "js/services/csv.js",
  "js/services/leitner.js",
  "js/services/taxonomy.js",
  "js/vendor/idb.js",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fonts, Google APIs: leave to the browser

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error()))
      )
  );
});
