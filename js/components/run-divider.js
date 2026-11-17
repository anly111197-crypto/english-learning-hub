// Draggable divider between the exam pane and the answer sheet (two columns, >= 1024px; hidden by CSS below that,
// where only one pane shows at a time). Mouse, touch and keyboard. The ratio is remembered in localStorage only.
import { h } from "./dom.js";
import {
  SPLIT_DEFAULT, SPLIT_MIN, SPLIT_MAX, clampSplit, stepSplit, splitFromPointer, loadSplit, saveSplit,
} from "../services/run-split.js";

// body: the .run-body grid. Returns the divider element; the grid reads --run-left / --run-right.
export function createRunDivider(body, storage) {
  let pct = loadSplit(storage);

  const apply = () => {
    body.style.setProperty("--run-left", `${pct}fr`);
    body.style.setProperty("--run-right", `${100 - pct}fr`);
    bar.setAttribute("aria-valuenow", String(Math.round(pct)));
    bar.dataset.pct = String(pct);
  };
  const set = (p, persist) => {
    pct = clampSplit(p);
    apply();
    if (persist) saveSplit(storage, pct);
  };

  const bar = h("div", {
    class: "run-divider", role: "separator", tabindex: "0", "aria-orientation": "vertical",
    "aria-label": "Kéo để đổi kích thước giữa đề và phiếu. Phím mũi tên trái phải đổi 5%; bấm đúp để về mặc định.",
    "aria-valuemin": String(SPLIT_MIN), "aria-valuemax": String(SPLIT_MAX),
    dataset: { role: "run-divider" },
  }, h("span", { class: "run-divider-grip", "aria-hidden": "true" }));

  let dragging = false;
  const move = (e) => {
    if (!dragging) return;
    const r = body.getBoundingClientRect();
    set(splitFromPointer(e.clientX, r.left, r.width), false);
  };
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    body.classList.remove("is-dragging");
    try { bar.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    saveSplit(storage, pct);
  };

  bar.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button > 0) return;
    dragging = true;
    body.classList.add("is-dragging"); // panes ignore the pointer so the PDF iframe cannot swallow the drag
    try { bar.setPointerCapture(e.pointerId); } catch { /* not capturable: window listeners below still work */ }
    e.preventDefault();
  });
  bar.addEventListener("pointermove", move);
  bar.addEventListener("pointerup", end);
  bar.addEventListener("pointercancel", end);
  bar.addEventListener("lostpointercapture", end);
  bar.addEventListener("dblclick", () => set(SPLIT_DEFAULT, true));
  bar.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") { set(stepSplit(pct, -1), true); e.preventDefault(); }
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") { set(stepSplit(pct, 1), true); e.preventDefault(); }
    else if (e.key === "Home") { set(SPLIT_DEFAULT, true); e.preventDefault(); }
  });

  apply();
  return bar;
}
