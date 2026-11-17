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
- Also vendored from the same package: `wasm/` (JBIG2 + JPX decoders, colour profile, quickjs; with their LICENSE_* files) and
  `standard_fonts/` (Foxit + Liberation fonts with LICENSE_FOXIT / LICENSE_LIBERATION), about 2.2 MB in all. They are not in
  APP_SHELL: `sw.js` caches them the first time a PDF needs them (scans with JPX / JBIG2 images, non-embedded fonts).
- Not loaded from a CDN: the app works offline once those files have been used. `getDocument` is called with `isEvalSupported: false`,
  `wasmUrl` and `standardFontDataUrl` pointing at the local folders (they must end with `/`); no cmap URL is set.
- To update: `npm pack pdfjs-dist@<version>`, copy the three legacy files + LICENSE, change this file and bump `CACHE_VERSION`.
