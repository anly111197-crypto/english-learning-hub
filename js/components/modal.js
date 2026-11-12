// Shared modal shell. Callers pass the content and footer nodes.
// Uses <dialog>.showModal(): Esc closes it, focus stays inside, the page behind is inert.
import { overlayOpened, overlayClosed } from "./overlay.js";

let counter = 0;

export function openModal({ title, content, footer, onClose }) {
  const titleId = `modal-title-${++counter}`;
  const dlg = document.createElement("dialog");
  dlg.className = "modal";
  dlg.setAttribute("aria-labelledby", titleId);

  const inner = document.createElement("div");
  inner.className = "modal-inner";
  const head = document.createElement("div");
  head.className = "modal-head";
  const h2 = document.createElement("h2");
  h2.id = titleId;
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
  let foot = null;
  if (footer) {
    foot = document.createElement("div");
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
  return {
    el: dlg,
    close,
    setContent: (node) => body.replaceChildren(node),
    setFooter: (node) => { if (foot) foot.replaceChildren(node); },
  };
}

// Yes/no question. Resolves true only when the confirm button is pressed. Cancel has the initial focus.
export function confirmModal({ title, message, confirmLabel = "Xác nhận", danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const p = document.createElement("p");
    p.textContent = message;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-text";
    cancel.textContent = "Hủy";
    cancel.setAttribute("autofocus", "");
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = danger ? "btn btn-danger" : "btn btn-primary";
    ok.textContent = confirmLabel;
    const actions = document.createElement("div");
    actions.className = "modal-actions";
    actions.append(cancel, ok);
    const modal = openModal({ title, content: p, footer: actions, onClose: () => resolve(answer) });
    cancel.addEventListener("click", () => modal.close());
    ok.addEventListener("click", () => { answer = true; modal.close(); });
  });
}
