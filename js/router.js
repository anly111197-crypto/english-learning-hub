// Minimal hash router. Routes are registered by app.js.
const routes = [];
let outlet = null;
let notFound = null;

export function addRoute(path, config) {
  routes.push({ path, ...config });
}

export function initRouter(viewEl, fallbackPath = "/") {
  outlet = viewEl;
  notFound = fallbackPath;
  window.addEventListener("hashchange", resolve);
  resolve();
}

function currentPath() {
  const raw = location.hash.replace(/^#/, "") || "/";
  return raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
}

function resolve() {
  const path = currentPath();
  const route = routes.find((r) => r.path === path);
  if (!route) {
    location.replace("#" + notFound);
    return;
  }
  route.view(outlet);
  document.title = route.title + " · English Learning Hub";
  document.body.dataset.route = route.key;
  for (const link of document.querySelectorAll("[data-nav]")) {
    if (link.dataset.nav === route.nav) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  outlet.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
