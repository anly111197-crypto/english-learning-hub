// Minimal hash router. Routes are registered by app.js.
//
// route = { path, key, nav, title (string | fn(params)), view, validate?(params) }
//   path   "/practice/:book/:test" - segments starting with ":" become params (strings)
//   view   a function(container, params), or an object { mount(container, params), update?(params), unmount?() }.
//          When two routes share the same view object, moving between them calls update() instead of
//          mount(), so the page is not rebuilt (used to open a panel over the matrix).
const routes = [];
let outlet = null;
let notFound = "/";
let current = null; // the view that is mounted now

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

function match(route, path) {
  const want = route.path.split("/");
  const got = path.split("/");
  if (want.length !== got.length) return null;
  const params = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(":")) {
      try {
        params[want[i].slice(1)] = decodeURIComponent(got[i]);
      } catch {
        return null;
      }
    } else if (want[i] !== got[i]) {
      return null;
    }
  }
  return params;
}

function resolve() {
  const path = currentPath();
  let route = null;
  let params = null;
  for (const r of routes) {
    params = match(r, path);
    if (params) { route = r; break; }
  }
  if (!route || (route.validate && !route.validate(params))) {
    location.replace("#" + (route?.fallback ?? notFound));
    return;
  }

  const view = route.view;
  const isObject = typeof view === "object";
  if (current && current !== view && current.unmount) current.unmount();
  const sameView = isObject && current === view && view.update;
  if (sameView) {
    view.update(params);
  } else {
    if (isObject) view.mount(outlet, params);
    else view(outlet, params);
    outlet.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  current = isObject ? view : null;

  const title = typeof route.title === "function" ? route.title(params) : route.title;
  document.title = title + " · English Learning Hub";
  document.body.dataset.route = route.key;
  for (const link of document.querySelectorAll("[data-nav]")) {
    if (link.dataset.nav === route.nav) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}
