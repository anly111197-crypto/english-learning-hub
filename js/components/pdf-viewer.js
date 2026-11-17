// PDF viewer for iPhone / iPad (spec 5.9). Safari on iOS / iPadOS cannot scroll a PDF inside an iframe (it usually shows
// page 1 only), so there the file is drawn page by page on canvases inside a scrollable box with PDF.js.
// PDF.js is vendored in js/vendor/pdfjs (no CDN: works offline) and loaded only when a PDF is opened here.
// The file is read from the blob: URL of the session only: not stored, not sent anywhere.
import { h } from "./dom.js";

const PDFJS_URL = new URL("../vendor/pdfjs/pdf.min.mjs", import.meta.url).href;
const WORKER_URL = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
const RENDERER_URL = new URL("../vendor/pdfjs/pdf.renderer.min.mjs", import.meta.url).href;

export const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const PAD = 12; // gap + side padding, in CSS px

let libPromise = null;
function loadLib() {
  libPromise ??= import(PDFJS_URL).then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = WORKER_URL;
    lib.GlobalWorkerOptions.rendererSrc = RENDERER_URL;
    return lib;
  });
  return libPromise;
}

export function nextZoom(z, dir) {
  const i = ZOOMS.findIndex((v) => v >= z - 1e-9);
  const cur = i < 0 ? ZOOMS.length - 1 : i;
  return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, cur + (dir < 0 ? -1 : 1)))];
}

// opts: { url, name }  ->  { el, destroy() }
export function createPdfViewer({ url, name }) {
  const st = { doc: null, pages: [], zoom: 1, fit: 1, ratio: 1.414, destroyed: false, obs: null, raf: 0 };

  const label = h("span", { class: "pdfv-zoom nowrap", dataset: { role: "pdf-zoom" } }, "100%");
  const pageInfo = h("span", { class: "pdfv-page nowrap", dataset: { role: "pdf-page" }, "aria-live": "polite" }, "Đang tải…");
  const minus = h("button", { type: "button", class: "btn btn-outline pdfv-btn", dataset: { role: "pdf-zoom-out" }, "aria-label": "Thu nhỏ", onClick: () => setZoom(-1) }, "−");
  const plus = h("button", { type: "button", class: "btn btn-outline pdfv-btn", dataset: { role: "pdf-zoom-in" }, "aria-label": "Phóng to", onClick: () => setZoom(1) }, "+");
  const scroller = h("div", { class: "pdfv-scroll", tabindex: "0", role: "document", "aria-label": `Đề: ${name}`, dataset: { role: "pdf-scroll" } },
    h("p", { class: "muted pdfv-msg" }, "Đang mở PDF…"));
  const el = h("div", { class: "run-pdf pdfv", dataset: { role: "pdf-viewer" } },
    h("div", { class: "pdfv-bar" }, minus, label, plus, pageInfo), scroller);

  function fail(err) {
    if (st.destroyed) return;
    pageInfo.textContent = "";
    scroller.replaceChildren(h("p", { class: "form-error pdfv-msg", dataset: { role: "pdf-error" } },
      `Không mở được PDF trong trang (${err?.message || err}). Bấm "Mở PDF trong tab mới" ở trên.`));
  }

  function pageWidth() { return Math.max(120, (scroller.clientWidth - PAD * 2) * st.fit * st.zoom); }

  function sizePages() {
    const w = pageWidth();
    for (const p of st.pages) {
      p.wrap.style.width = `${Math.round(w)}px`;
      p.wrap.style.height = `${Math.round(w * (p.ratio || st.ratio))}px`;
    }
  }

  function clearCanvas(p) {
    p.task?.cancel();
    p.task = null;
    if (p.canvas) { p.canvas.width = 0; p.canvas.height = 0; p.canvas.remove(); }
    p.canvas = null;
    p.drawn = 0;
  }

  async function draw(p) {
    if (st.destroyed || !st.doc) return;
    const w = pageWidth();
    if (p.drawn === w || p.busy) return;
    p.busy = true;
    try {
      const page = await st.doc.getPage(p.n);
      if (st.destroyed) return;
      const base = page.getViewport({ scale: 1 });
      p.ratio = base.height / base.width;
      const cssScale = w / base.width;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: cssScale * dpr });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      p.task?.cancel();
      p.task = page.render({ canvasContext: canvas.getContext("2d"), viewport });
      await p.task.promise;
      if (st.destroyed) return;
      p.canvas?.remove();
      p.canvas = canvas;
      p.wrap.style.height = `${Math.round(w * p.ratio)}px`;
      p.wrap.replaceChildren(canvas);
      p.drawn = w;
      page.cleanup();
    } catch (e) {
      if (e?.name !== "RenderingCancelledException" && !st.destroyed) p.wrap.dataset.error = "true";
    } finally {
      p.busy = false;
      if (!st.destroyed && p.visible && p.drawn !== pageWidth()) draw(p); // zoom changed while drawing
    }
  }

  function updateInfo() {
    st.raf = 0;
    if (st.destroyed || !st.pages.length) return;
    const mid = scroller.getBoundingClientRect();
    const centre = mid.top + mid.height / 2;
    let cur = st.pages[0];
    for (const p of st.pages) {
      const r = p.wrap.getBoundingClientRect();
      if (r.top <= centre) cur = p;
      else break;
    }
    pageInfo.textContent = `Trang ${cur.n} / ${st.pages.length}`;
    pageInfo.dataset.page = String(cur.n);
  }

  function setZoom(dir) {
    const z = nextZoom(st.zoom, dir);
    if (z === st.zoom) return;
    const keep = scroller.scrollHeight ? scroller.scrollTop / scroller.scrollHeight : 0;
    st.zoom = z;
    label.textContent = `${Math.round(z * 100)}%`;
    minus.disabled = z === ZOOMS[0];
    plus.disabled = z === ZOOMS[ZOOMS.length - 1];
    sizePages();
    scroller.scrollTop = keep * scroller.scrollHeight;
    for (const p of st.pages) if (p.visible) draw(p);
    updateInfo();
  }

  async function open() {
    try {
      const lib = await loadLib();
      if (st.destroyed) return;
      // No eval, and nothing is fetched for fonts / cmaps: the file stays on this device.
      const task = lib.getDocument({ url, isEvalSupported: false });
      st.doc = await task.promise;
      if (st.destroyed) { st.doc.destroy(); return; }
      const first = await st.doc.getPage(1);
      const vp = first.getViewport({ scale: 1 });
      st.ratio = vp.height / vp.width;
      st.fit = 1;
      scroller.replaceChildren();
      for (let n = 1; n <= st.doc.numPages; n++) {
        const wrap = h("div", { class: "pdfv-pg", dataset: { page: String(n) } });
        scroller.append(wrap);
        st.pages.push({ n, wrap, canvas: null, task: null, drawn: 0, busy: false, visible: false, ratio: st.ratio });
      }
      sizePages();
      st.obs = new IntersectionObserver((entries) => {
        for (const e of entries) {
          const p = st.pages[Number(e.target.dataset.page) - 1];
          p.visible = e.isIntersecting;
          if (e.isIntersecting) draw(p);
          else if (p.canvas && Math.abs(p.n - Number(pageInfo.dataset.page || 1)) > 3) clearCanvas(p); // free memory far away
        }
      }, { root: scroller, rootMargin: "600px 0px" });
      for (const p of st.pages) st.obs.observe(p.wrap);
      scroller.addEventListener("scroll", () => { if (!st.raf) st.raf = requestAnimationFrame(updateInfo); }, { passive: true });
      updateInfo();
    } catch (err) {
      fail(err);
    }
  }
  open();

  return {
    el,
    destroy() {
      st.destroyed = true;
      if (st.raf) cancelAnimationFrame(st.raf);
      st.obs?.disconnect();
      for (const p of st.pages) clearCanvas(p);
      st.pages = [];
      try { st.doc?.destroy(); } catch { /* already gone */ }
      st.doc = null;
    },
  };
}
