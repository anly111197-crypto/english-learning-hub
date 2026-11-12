// Shared modal shell. Callers pass the content and footer nodes.
// Uses <dialog>.showModal(): Esc closes it, focus stays inside, the page behind is inert.
import { overlayOpened, overlayClosed } from "./overlay.js";

export function openModal({ title, content, footer, onClose }) {
  const dlg = document.createElement("dialog");
  dlg.className = "modal";
  dlg.setAttribute("aria-labelledby", "modal-title");

  const inner = document.createElement("div");
  inner.className = "modal-inner";
  const head = document.createElement("div");
  head.className = "modal-head";
  const h2 = document.createElement("h2");
  h2.id = "modal-title";
  h2.className = "modal-title";
  h2.textContent = title;
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "icon-btn";
  closeBtn.setAttribute("aria-label", "Đóng");
  closeBtn.innerHTML = '<svg class="icon"><use href="#i-close"/></svg>';
  head.append(h2, closeBtn);
  const body = document.createElement("div");
  body.className = "modal-body";
  body.append(content);
  inner.append(head, body);
  if (footer) {
    const foot = document.createElement("div");
    foot.className = "modal-foot";
    foot.append(footer);
    inner.append(foot);
  }
  dlg.append(inner);

  const close = () => { if (dlg.open) dlg.close(); };
  closeBtn.addEventListener("click", close);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); }); // click on the dimmed backdrop
  dlg.addEventListener("close", () => {
    overlayClosed();
    dlg.remove();
    onClose?.();
  });

  document.body.append(dlg);
  overlayOpened();
  dlg.showModal();
  return { el: dlg, close };
}
