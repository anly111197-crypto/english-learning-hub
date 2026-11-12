// A small status message at the bottom of the screen.
let el = null;
let timer = null;

export function showToast(message, kind = "ok") {
  if (!el) {
    el = document.createElement("div");
    el.className = "status-line";
    el.setAttribute("role", "status");
    document.body.append(el);
  }
  el.textContent = message;
  el.dataset.kind = kind;
  el.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => { el.hidden = true; }, kind === "error" ? 9000 : 5000);
}
