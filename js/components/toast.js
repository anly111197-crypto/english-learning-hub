// A small status message at the bottom of the screen. action: optional { label, onClick } shown as a button.
let el = null;
let timer = null;

export function showToast(message, kind = "ok", action = null) {
  if (!el) {
    el = document.createElement("div");
    el.className = "status-line";
    el.setAttribute("role", "status");
    document.body.append(el);
  }
  const text = document.createElement("span");
  text.textContent = message;
  el.replaceChildren(text);
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-action";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      el.hidden = true;
      action.onClick();
    });
    el.append(btn);
  }
  el.dataset.kind = kind;
  el.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => { el.hidden = true; }, kind === "error" ? 9000 : action ? 8000 : 5000);
}
