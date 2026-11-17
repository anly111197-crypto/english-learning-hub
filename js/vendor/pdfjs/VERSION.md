# PDF.js (vendored)

- Package: `pdfjs-dist` **6.5.438** (npm `latest` when vendored, 2026-11-17)
- Build used: `legacy/build/` (runs on older Safari too)
- Files (all from the same package version):
  - `pdf.min.mjs` - main library
  - `pdf.worker.min.mjs` - parser worker
  - `pdf.renderer.min.mjs` - renderer worker (new since 6.x; set as `GlobalWorkerOptions.rendererSrc`)
  - `LICENSE` - Apache License 2.0, Copyright Mozilla Foundation
- Source: https://github.com/mozilla/pdf.js
- Used only by `js/components/pdf-viewer.js`, only on iPhone / iPad ("File trên máy"). Loaded with a dynamic `import()`.
- Not loaded from a CDN: the app works offline. `getDocument` is called with `isEvalSupported: false`; no font, cmap or
  wasm URL is set, so nothing is fetched from the network.
- To update: `npm pack pdfjs-dist@<version>`, copy the three legacy files + LICENSE, change this file and bump `CACHE_VERSION`.
