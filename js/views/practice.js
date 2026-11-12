// Cambridge Practice · Tiến độ: summary cards, filters, matrix Cam 19 -> 10 x Test 1-4, test panel.
import { h } from "../components/dom.js";
import { bandCell } from "../components/band-cell.js";
import { openSheet } from "../components/sheet.js";
import { showToast } from "../components/toast.js";
import { formatBand } from "../services/bands.js";
import {
  BOOKS, TESTS, SKILLS, SKILL_NAMES, indexAttempts, testKey, testSummary, booksDoneCount, totalDone,
  averageSummary, countNeedsImprovement, matchesFilter,
} from "../services/progress.js";
import { nextTest } from "../services/next-test.js";
import { loadPracticeData, setPinned } from "../services/practice-store.js";
import { buildDetail } from "./practice-detail.js";
import { openResultModal, openLinksModal } from "./practice-forms.js";
import { openQuickCapture } from "../components/quick-capture.js";
import { notesFor } from "../services/notebook-ops.js";

const state = {
  active: false,
  container: null,
  params: null, // { book, test } strings from the route, or null
  data: null,
  index: null,
  next: null,
  sheet: null,
  filter: { status: "all", skill: null },
  expanded: new Set(), // books opened in the phone list
  token: 0,
};
const phone = window.matchMedia("(max-width: 767px)");

const STATUS_FILTERS = [
  ["all", "Tất cả"],
  ["todo", "Chưa làm"],
  ["improve", "Cần cải thiện (<6.5)"],
];

// ---- Header shared with the Notebook tab ----
export function renderPracticeHeader(container, activeTab) {
  const tab = (href, label, active) => h("a", { class: "tab", href, "aria-current": active ? "page" : null }, label);
  container.append(
    h("h1", { class: "page-title" }, "Cambridge Practice"),
    h("p", { class: "page-sub" }, "Theo dõi kết quả và tiến độ làm đề Cam 10–19. Ứng dụng không chứa đề, audio hay đáp án."),
    h("nav", { class: "tabs", "aria-label": "Cambridge Practice" },
      tab("#/practice", "Tiến độ luyện đề", activeTab === "progress"),
      tab("#/practice/notebooks", "Notebook & tài liệu", activeTab === "notebooks")));
}

const parsed = () => (state.params ? { book: Number(state.params.book), test: Number(state.params.test) } : null);

// ---- Summary cards ----
function renderCards(host) {
  const done = totalDone(state.index);
  const avg = averageSummary(state.index);
  const improve = countNeedsImprovement(state.index);
  const o = avg.overall;

  const card = (label, value, sub, extra) => h("section", { class: "summary-card" },
    h("p", { class: "summary-label", title: label }, label),
    h("p", { class: "summary-value nowrap" }, value),
    h("p", { class: "summary-sub" }, sub),
    extra ?? null);

  const skillLine = h("p", { class: "summary-skills nowrap" },
    SKILLS.map((k) => h("span", { class: "nowrap" }, `${k} ${avg.rounded[k] === null ? "–" : formatBand(avg.rounded[k])}`)));

  host.replaceChildren(
    card("Tiến độ Cam 10–19", `${done}/${BOOKS.length * TESTS.length} test`, "Test có cả Listening và Reading"),
    card("Band trung bình", o.value === null ? "–" : formatBand(o.value),
      o.value === null ? "Cần ít nhất 2 kỹ năng" : `${o.estimated ? `Ước tính (${o.count}/4) · ` : ""}Mục tiêu 7.0`, skillLine),
    card("Kỹ năng yếu nhất", avg.weakest ? SKILL_NAMES[avg.weakest] : "–",
      avg.weakest ? `Band trung bình ${formatBand(avg.weakestBand)}` : "Cần ít nhất 2 kỹ năng"),
    card("Ô cần cải thiện", String(improve), "kỹ năng của test có band dưới 6.5"));
}

// ---- Filters ----
function renderFilters(host) {
  const chip = (label, pressed, onClick) => h("button", { type: "button", class: "chip-btn nowrap", "aria-pressed": String(pressed), onClick }, label);
  const set = (patch) => {
    const focusedLabel = document.activeElement?.textContent;
    Object.assign(state.filter, patch);
    renderFilters(host);
    renderMatrix();
    [...host.querySelectorAll("button")].find((b) => b.textContent === focusedLabel)?.focus();
  };
  host.replaceChildren(
    h("div", { class: "chip-group", role: "group", "aria-label": "Lọc theo trạng thái" },
      STATUS_FILTERS.map(([key, label]) => chip(label, state.filter.status === key, () => set({ status: key })))),
    h("div", { class: "chip-group", role: "group", "aria-label": "Lọc theo kỹ năng" },
      chip("Mọi kỹ năng", state.filter.skill === null, () => set({ skill: null })),
      SKILLS.map((k) => chip(SKILL_NAMES[k], state.filter.skill === k, () => set({ skill: k })))));
}

function legend() {
  const sw = (level, text) => h("span", { class: "legend-item nowrap" }, h("span", { class: "legend-swatch", dataset: { level } }), text);
  return h("div", { class: "legend", "aria-label": "Chú giải" },
    sw("empty", "Chưa làm"), sw("low", "Dưới 6.0"), sw("mid", "6.0–6.5"), sw("high", "7.0 trở lên"),
    h("span", { class: "legend-item nowrap" }, h("span", { class: "legend-outline is-viewing" }), "Đang xem"),
    h("span", { class: "legend-item nowrap" }, h("span", { class: "legend-outline is-next" }), "Tiếp theo"));
}

// ---- Matrix (≥768) and book list (<768) ----
function cellLabel(book, test, summary, isNext) {
  const parts = SKILLS.map((k) => `${SKILL_NAMES[k]} ${summary.bands[k] === null ? "chưa có" : formatBand(summary.bands[k])}`);
  return `Cam ${book} Test ${test}. ${parts.join(", ")}${isNext ? ". Buổi luyện tiếp theo" : ""}`;
}

function openTest(book, test) {
  location.hash = `#/practice/${book}/${test}`;
}

function skillCells(summary) {
  return SKILLS.map((k) => {
    const cell = bandCell({ letter: k, band: summary.bands[k], marked: k === "W" && Boolean(summary.writing?.marked) });
    if (state.filter.skill && state.filter.skill !== k) cell.classList.add("is-dim");
    return cell;
  });
}

function testCell(book, test) {
  const entry = state.index.get(testKey(book, test));
  const summary = testSummary(entry);
  const view = parsed();
  const isViewing = view?.book === book && view?.test === test;
  const isNext = state.next?.book === book && state.next?.test === test;
  const match = matchesFilter(entry, state.filter);
  return h("button", {
    type: "button",
    class: `test-cell${isViewing ? " is-viewing" : ""}${isNext ? " is-next" : ""}${match ? "" : " is-dim"}`,
    "aria-label": cellLabel(book, test, summary, isNext),
    "aria-current": isViewing ? "true" : null,
    onClick: () => openTest(book, test),
  }, h("span", { class: "test-cell-grid" }, skillCells(summary)));
}

function bookMatches(book) {
  if (state.filter.status === "all") return true;
  return TESTS.some((t) => matchesFilter(state.index.get(testKey(book, t)), state.filter));
}

function renderTable(host, books) {
  const table = h("table", { class: "matrix" },
    h("thead", {}, h("tr", {},
      h("th", { scope: "col" }, "Cambridge"),
      TESTS.map((t) => h("th", { scope: "col" }, `Test ${t}`)),
      h("th", { scope: "col", class: "nowrap" }, "Hoàn thành"))),
    h("tbody", {}, books.map((book) => h("tr", {},
      h("th", { scope: "row", class: "nowrap" }, `Cam ${book}`),
      TESTS.map((t) => h("td", {}, testCell(book, t))),
      h("td", { class: "matrix-done nowrap" }, `${booksDoneCount(state.index, book)}/4`)))));
  host.replaceChildren(h("div", { class: "matrix-scroll" }, table));
}

function renderBookList(host, books) {
  host.replaceChildren(h("ul", { class: "book-list" }, books.map((book) => {
    const open = state.expanded.has(book);
    const panelId = `book-${book}`;
    const toggle = h("button", {
      type: "button", class: "book-head", "aria-expanded": String(open), "aria-controls": panelId,
      onClick: () => {
        if (state.expanded.has(book)) state.expanded.delete(book);
        else state.expanded.add(book);
        renderMatrix();
      },
    }, h("span", { class: "book-name nowrap" }, `Cam ${book}`),
      h("span", { class: "book-done nowrap" }, `${booksDoneCount(state.index, book)}/4 test`),
      h("span", { class: "chevron-wrap", "aria-hidden": "true" }));
    toggle.lastChild.innerHTML = '<svg class="icon chevron"><use href="#i-chevron"/></svg>';

    const rows = open ? h("ul", { class: "test-rows", id: panelId }, TESTS.map((t) => {
      const entry = state.index.get(testKey(book, t));
      const summary = testSummary(entry);
      const view = parsed();
      const isViewing = view?.book === book && view?.test === t;
      const isNext = state.next?.book === book && state.next?.test === t;
      const match = matchesFilter(entry, state.filter);
      return h("li", {}, h("button", {
        type: "button",
        class: `test-row${isViewing ? " is-viewing" : ""}${isNext ? " is-next" : ""}${match ? "" : " is-dim"}`,
        "aria-label": cellLabel(book, t, summary, isNext),
        "aria-current": isViewing ? "true" : null,
        onClick: () => openTest(book, t),
      }, h("span", { class: "test-row-name nowrap" }, `Test ${t}`),
        h("span", { class: "test-row-cells" }, skillCells(summary)),
        isNext ? h("span", { class: "tag nowrap" }, "Tiếp theo") : null));
    })) : null;

    return h("li", { class: "book-card" }, toggle, rows);
  })));
}

function renderMatrix() {
  const host = state.container?.querySelector("#practice-matrix");
  if (!host || !state.index) return;
  const books = [...BOOKS].reverse().filter(bookMatches); // Cam 19 -> 10
  if (books.length === 0) {
    host.replaceChildren(h("p", { class: "empty-state" }, "Không có test nào khớp bộ lọc."));
    return;
  }
  if (phone.matches) renderBookList(host, books);
  else renderTable(host, books);
}

// ---- Panel ----
// Words and errors with an occurrence in this test (in the order they were recorded).
function itemsFor(book, test) {
  const occs = state.data.occurrences
    .filter((o) => o.source?.book === book && o.source?.test === test)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const pick = (type, records) => {
    const byId = new Map(records.map((r) => [r.id, r]));
    const seen = new Map();
    for (const o of occs) {
      if (o.itemType === type && byId.has(o.itemId) && !seen.has(o.itemId)) seen.set(o.itemId, { rec: byId.get(o.itemId), source: o.source });
    }
    return [...seen.values()];
  };
  return { vocab: pick("vocab", state.data.vocab), errors: pick("error", state.data.errors) };
}

function closePanelQuietly() {
  if (state.sheet) {
    state.sheet.routeClosed = true; // the close event is asynchronous: mark it so onClose does not navigate
    if (state.sheet.isOpen()) state.sheet.close();
  }
  state.sheet = null;
}

function syncPanel() {
  const view = parsed();
  if (!view || !state.index) {
    closePanelQuietly();
    return;
  }
  const { book, test } = view;
  const key = testKey(book, test);
  const entry = state.index.get(key);
  const testRec = state.data.tests.find((t) => t.key === key);
  const isNext = state.next?.book === book && state.next?.test === test;
  const reload = async () => { await refresh(); };

  const detail = buildDetail({
    book, test, entry, testRec, isNext, items: itemsFor(book, test),
    notes: notesFor(state.data.notes ?? [], "test", key), notebooks: state.data.notebooks ?? [],
  }, {
    quickCapture: () => openQuickCapture({ source: { book, test } }),
    edit: (skill, task) => openResultModal({ book, test, skill, task: task ?? 2, entry, onSaved: reload }),
    enterResults: () => {
      const e = entry ?? {};
      const first = !e.L ? ["L", 2] : !e.R ? ["R", 2] : !e.W2 ? ["W", 2] : !e.W1 ? ["W", 1] : !e.S ? ["S", 2] : ["L", 2];
      openResultModal({ book, test, skill: first[0], task: first[1], entry, onSaved: reload });
    },
    togglePin: async () => {
      try {
        await setPinned(book, test, !testRec?.pinned);
        showToast(testRec?.pinned ? "Đã bỏ ghim." : `Đã ghim Cam ${book} Test ${test} làm buổi tiếp theo.`);
        await reload();
      } catch (err) {
        showToast(err.message || "Không ghim được.", "error");
      }
    },
    editLinks: () => openLinksModal({ book, test, testRec, onSaved: reload }),
  });

  if (state.sheet?.isOpen()) {
    state.sheet.setHeader({ title: detail.title, badge: detail.badge });
    state.sheet.setContent(detail.node);
  } else {
    const sheet = openSheet({
      title: detail.title,
      badge: detail.badge,
      content: detail.node,
      onClose: () => {
        if (sheet.routeClosed) return;
        if (state.sheet === sheet) state.sheet = null;
        if (state.params) location.hash = "#/practice"; // closed by the user (Esc, ✕, backdrop)
      },
    });
    state.sheet = sheet;
  }
}

// ---- Data and lifecycle ----
function recompute() {
  state.index = indexAttempts(state.data.attempts);
  state.next = nextTest(state.data);
}

function renderAll() {
  const root = state.container;
  if (!root) return;
  renderCards(root.querySelector("#practice-cards"));
  renderFilters(root.querySelector("#practice-filters"));
  renderMatrix();
}

async function refresh() {
  const data = await loadPracticeData();
  if (!state.active) return;
  state.data = data;
  recompute();
  renderAll();
  syncPanel();
}

phone.addEventListener("change", () => { if (state.active && state.index) renderMatrix(); });
// New words or errors were saved (quick capture, backup restore): reload so the panel shows them.
document.addEventListener("elh:data-changed", () => { if (state.active && state.index) refresh().catch(() => {}); });

export const practiceView = {
  mount(container, params, query = {}) {
    state.active = true;
    // The Dashboard links here with a ready filter, e.g. #/practice?status=improve
    state.filter = {
      status: ["todo", "improve"].includes(query.status) ? query.status : "all",
      skill: SKILLS.includes(query.skill) ? query.skill : null,
    };
    state.container = container;
    state.params = params?.book ? params : null;
    state.data = null;
    state.index = null;
    const token = ++state.token;

    const root = h("div", { class: "practice" });
    renderPracticeHeader(root, "progress");
    root.append(
      h("div", { id: "practice-cards", class: "summary-grid" }),
      h("div", { id: "practice-filters", class: "filters" }),
      legend(),
      h("div", { id: "practice-matrix", class: "matrix-host" }, h("p", { class: "muted" }, "Đang tải…")));
    container.replaceChildren(root);

    loadPracticeData().then((data) => {
      if (token !== state.token) return;
      state.data = data;
      recompute();
      if (state.expanded.size === 0 && state.next) state.expanded.add(state.next.book);
      renderAll();
      syncPanel();
    }).catch((err) => {
      if (token !== state.token) return;
      container.querySelector("#practice-matrix").replaceChildren(h("p", { class: "form-error" }, `Không đọc được dữ liệu: ${err.message}`));
    });
  },

  // Route changed between #/practice and #/practice/:book/:test without leaving the page.
  update(params) {
    state.params = params?.book ? params : null;
    if (!state.index) return; // still loading: mount() will open the panel when data arrives
    renderMatrix(); // moves the "Đang xem" outline
    syncPanel();
  },

  unmount() {
    state.active = false;
    state.params = null;
    state.token++;
    closePanelQuietly();
  },
};
