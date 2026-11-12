import { addRoute, initRouter } from "./router.js";
import { placeholderView } from "./views/placeholder.js";
import { dashboardView } from "./views/dashboard.js";
import { devView } from "./views/dev.js";
import { practiceView } from "./views/practice.js";
import { practiceNotebooksView } from "./views/practice-notebooks.js";
import { vocabView } from "./views/vocab.js";
import { errorsView } from "./views/errors.js";
import { initQuickCapture } from "./components/quick-capture.js";
import { mountBackupControls } from "./components/backup-ui.js";

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

const VIEWS = {
  dashboard: dashboardView,
  practice: practiceView,
  "practice-notebooks": practiceNotebooksView,
  vocab: vocabView,
  errors: errorsView,
};
for (const r of ROUTES) addRoute(r.path, { ...r, view: VIEWS[r.key] ?? placeholderView(r.title) });

// Test panel over the matrix: same view object as "/practice", so the page is not rebuilt.
addRoute("/practice/:book/:test", {
  key: "practice-test",
  nav: "practice",
  title: (p) => `Cam ${p.book} · Test ${p.test}`,
  view: practiceView,
  fallback: "/practice",
  validate: (p) => /^(1\d)$/.test(p.book) && /^[1-4]$/.test(p.test),
});

// Dev tools exist only when the page is opened with ?dev=1 (the query comes before the #).
if (new URLSearchParams(location.search).get("dev") === "1") {
  addRoute("/dev", { key: "dev", nav: null, title: "Dev", view: devView });
}

mountBackupControls(document.getElementById("backup-controls"), "navy");
initQuickCapture();

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
