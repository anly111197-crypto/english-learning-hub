// Tiny element builder: h("button", { class: "btn", onClick: fn }, "Label", childNode).
// Text is always inserted as text nodes, never as HTML.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (/^on[A-Z]/.test(key)) el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

// A small inline SVG icon from the sprite in index.html. Returns a span (h() cannot make SVG elements).
export function icon(id, className = "") {
  const span = document.createElement("span");
  span.className = `icon-wrap ${className}`.trim();
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg class="icon"><use href="#${id}"/></svg>`;
  return span;
}

export function autoGrow(textarea) {
  const fit = () => {
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + "px";
  };
  textarea.addEventListener("input", fit);
  requestAnimationFrame(fit);
}

// Local date as yyyy-mm-dd (toISOString would use UTC and can give yesterday).
export function todayIso(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function formatDateVi(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}
