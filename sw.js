// Network-first for same-origin files: online -> fresh copy (and cache it); offline -> cache.
// Bump CACHE_VERSION at every step so old caches are dropped.
const CACHE_VERSION = "elh-v10";

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
  "css/errors.css",
  "css/warmup.css",
  "css/dashboard.css",
  "css/practice-run.css",
  "css/sync.css",
  "js/config.js",
  "js/app.js",
  "js/router.js",
  "js/views/placeholder.js",
  "js/views/dashboard.js",
  "js/views/practice.js",
  "js/views/practice-detail.js",
  "js/views/practice-forms.js",
  "js/views/practice-run.js",
  "js/views/practice-run-source.js",
  "js/views/practice-notebooks.js",
  "js/views/vocab.js",
  "js/views/vocab-detail.js",
  "js/views/errors.js",
  "js/views/warmup.js",
  "js/views/warmup-render.js",
  "js/views/error-detail.js",
  "js/views/notebook-forms.js",
  "js/components/notes-block.js",
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
  "js/components/sync-ui.js",
  "js/services/schema.js",
  "js/services/dedupe.js",
  "js/services/db.js",
  "js/services/repo.js",
  "js/services/merge.js",
  "js/services/backup.js",
  "js/services/google-auth.js",
  "js/services/sync-drive.js",
  "js/services/sync-controller.js",
  "js/services/sync-status.js",
  "js/services/bands.js",
  "js/services/progress.js",
  "js/services/next-test.js",
  "js/services/practice-store.js",
  "js/services/practice-run.js",
  "js/services/capture.js",
  "js/services/capture-source.js",
  "js/services/vocab-ops.js",
  "js/services/csv.js",
  "js/services/leitner.js",
  "js/services/taxonomy.js",
  "js/services/errors.js",
  "js/services/warmup.js",
  "js/services/dashboard-stats.js",
  "js/services/warmup-ops.js",
  "js/services/diff.js",
  "js/services/error-ops.js",
  "js/services/notebook-ops.js",
  "js/services/notebook-text.js",
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
  // Never touch (and never cache) the learner's own files: blob: URLs of the practice screen (PDF / audio picked on
  // this computer) and Google Drive (preview frames). A blob: URL reports this site's origin, so check the scheme first.
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (url.hostname === "drive.google.com" || url.hostname.endsWith(".googleusercontent.com")) return;
  // Google sign-in and the Drive API (sync): tokens and the learner's data must never be cached.
  if (url.hostname === "accounts.google.com" || url.hostname.endsWith(".googleapis.com") || url.hostname.endsWith(".gstatic.com")) return;
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
