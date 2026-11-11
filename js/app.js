import { addRoute, initRouter } from "./router.js";
import { placeholderView } from "./views/placeholder.js";

const ROUTES = [
  { path: "/",                    key: "dashboard",          nav: "dashboard", title: "Dashboard" },
  { path: "/practice",            key: "practice",           nav: "practice",  title: "Cambridge Practice" },
  { path: "/practice/notebooks",  key: "practice-notebooks", nav: "practice",  title: "Cambridge Practice · Notebook & tài liệu" },
  { path: "/ai/writing",          key: "ai-writing",         nav: "ai",        title: "Writing & Speaking AI" },
  { path: "/ai/speaking",         key: "ai-speaking",        nav: "ai",        title: "Writing & Speaking AI" },
  { path: "/vocab",               key: "vocab",              nav: "vocab",     title: "Vocabulary Bank" },
  { path: "/errors",              key: "errors",             nav: "errors",    title: "Grammar Notebook" },
  { path: "/warmup",              key: "warmup",             nav: null,        title: "Khởi động 15'" },
];

for (const r of ROUTES) addRoute(r.path, { ...r, view: placeholderView(r.title) });

initRouter(document.getElementById("view"), "/");

// "Ghi nhanh" (Step 4 wires the real sheet; shortcut key N comes with it).
document.getElementById("fab-quick-capture").addEventListener("click", () => {
  document.dispatchEvent(new CustomEvent("elh:quick-capture"));
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW registration failed:", err));
  });
}
