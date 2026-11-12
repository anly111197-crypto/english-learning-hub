// Detail panel: right-hand overlay at >= 768px, bottom sheet below (the switch is pure CSS).
// Closes with Esc, the close button or a click on the dimmed backdrop. Hides the FAB while open.
import { overlayOpened, overlayClosed } from "./overlay.js";

export function openSheet({ title, badge = "", content, onClose }) {
  const dlg = document.createElement("dialog");
  dlg.className = "sheet";
  dlg.setAttribute("aria-labelledby", "sheet-title");

  const inner = document.createElement("div");
  inner.className = "sheet-inner";
  const handle = document.createElement("div");
  handle.className = "sheet-handle";
  handle.setAttribute("aria-hidden", "true");
  const head = document.createElement("div");
  head.className = "sheet-head";
  const titleWrap = document.createElement("div");
  titleWrap.className = "sheet-titles";
  const h2 = document.createElement("h2");
  h2.id = "sheet-title";
  h2.className = "sheet-title";
  const badgeEl = document.createElement("span");
  badgeEl.className = "chip nowrap";
  titleWrap.append(h2, badgeEl);
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "icon-btn";
  closeBtn.setAttribute("aria-label", "Đóng");
  closeBtn.innerHTML = '<svg class="icon"><use href="#i-close"/></svg>';
  head.append(titleWrap, closeBtn);
  const body = document.createElement("div");
  body.className = "sheet-body";
  inner.append(handle, head, body);
  dlg.append(inner);

  const setHeader = ({ title: t, badge: b }) => {
    h2.textContent = t;
    badgeEl.textContent = b ?? "";
    badgeEl.hidden = !b;
  };
  const setContent = (node) => {
    const top = body.scrollTop;
    body.replaceChildren(node);
    body.scrollTop = top;
  };
  setHeader({ title, badge });
  setContent(content);

  const close = () => { if (dlg.open) dlg.close(); };
  closeBtn.addEventListener("click", close);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
  dlg.addEventListener("close", () => {
    overlayClosed();
    dlg.remove();
    onClose?.();
  });

  document.body.append(dlg);
  overlayOpened();
  dlg.showModal();
  return { el: dlg, close, setHeader, setContent, isOpen: () => dlg.open };
}
