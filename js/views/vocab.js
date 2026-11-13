// Vocabulary Bank (spec 5.7): search, filters, table (>= 768) or cards (< 768), bulk actions, word panel.
import { h, formatDateVi } from "../components/dom.js";
import { openSheet } from "../components/sheet.js";
import { confirmModal } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import { downloadText } from "../components/download.js";
import { speakButton } from "../components/speech.js";
import { openEnrich } from "../components/enrich-modal.js";
import { openQuickCapture } from "../components/quick-capture.js";
import { foldForSearch } from "../services/dedupe.js";
import { isDue, isoDate, addDays } from "../services/leitner.js";
import { sourceLabel } from "../services/taxonomy.js";
import { sourceKey } from "../services/dedupe.js";
import { BOOKS } from "../services/progress.js";
import { vocabCsv } from "../services/csv.js";
import { loadVocabData, updateVocab, mergeVocab, markLearned, deleteVocab, findConflict } from "../services/vocab-ops.js";
import { buildVocabDetail } from "./vocab-detail.js";
import { notesFor } from "../services/notebook-ops.js";

const NO_TOPIC = "__none";
const phone = window.matchMedia("(max-width: 767px)");

const state = {
  active: false,
  container: null,
  data: null, // { vocab, occurrences }
  derived: new Map(), // word id -> { sources, text }
  filters: { q: "", source: "", topic: "", boxes: new Set(), pending: false, due: false },
  selected: new Set(),
  sheet: null,
  panelId: null,
  token: 0,
  refs: {},
};

// ---- Derived data ----
function derive() {
  const byWord = new Map();
  for (const o of state.data.occurrences) {
    if (!byWord.has(o.itemId)) byWord.set(o.itemId, []);
    byWord.get(o.itemId).push(o);
  }
  state.derived = new Map();
  for (const w of state.data.vocab) {
    const seen = new Map();
    for (const s of [...(byWord.get(w.id) ?? []).map((o) => o.source), ...(w.contexts ?? []).map((c) => c.source)]) {
      if (s && s.book) seen.set(sourceKey(s), s);
    }
    const sources = [...seen.values()];
    const text = foldForSearch([
      w.word, w.lemma, w.meaningVi, w.definitionEn, w.topic, ...(w.collocations ?? []), ...(w.synonyms ?? []),
      ...(w.contexts ?? []).map((c) => c.sentence),
    ].join(" "));
    state.derived.set(w.id, { sources, text });
  }
  for (const id of [...state.selected]) if (!state.derived.has(id)) state.selected.delete(id);
}

const topicsList = () => [...new Set(state.data.vocab.map((w) => w.topic).filter(Boolean))].sort((a, b) => a.localeCompare(b));

function matches(w) {
  const f = state.filters;
  const d = state.derived.get(w.id);
  if (f.q && !d.text.includes(foldForSearch(f.q).trim())) return false;
  if (f.source) {
    const ok = f.source === "W" || f.source === "S"
      ? d.sources.some((s) => s.skill === f.source)
      : d.sources.some((s) => s.book === Number(f.source));
    if (!ok) return false;
  }
  if (f.topic) {
    if (f.topic === NO_TOPIC ? w.topic : w.topic !== f.topic) return false;
  }
  if (f.boxes.size && !f.boxes.has(w.box)) return false;
  if (f.pending && w.enriched) return false;
  if (f.due && !isDue(w)) return false;
  return true;
}

const filtered = () => state.data.vocab.filter(matches).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

// ---- Pieces ----
function nextReviewText(w) {
  if (!w.nextReview) return "–";
  const today = isoDate();
  if (w.nextReview === today) return "Hôm nay";
  if (w.nextReview < today) return `Quá hạn · ${formatDateVi(w.nextReview).slice(0, 5)}`;
  if (w.nextReview === addDays(today, 1)) return "Ngày mai";
  return formatDateVi(w.nextReview);
}

function sourceText(w) {
  const { sources } = state.derived.get(w.id);
  if (sources.length === 0) return h("span", { class: "muted" }, "–");
  const first = sourceLabel(sources[0], { short: true });
  return h("span", { class: "nowrap" }, first, sources.length > 1 ? h("span", { class: "muted" }, ` +${sources.length - 1}`) : null);
}

function meaningText(w) {
  return w.meaningVi
    ? h("span", {}, w.meaningVi)
    : h("span", { class: "muted" }, "Chưa có nghĩa");
}

const pendingTag = (w) => (w.enriched ? null : h("span", { class: "tag nowrap" }, "Chờ hoàn thiện"));

function checkbox(w) {
  const input = h("input", {
    type: "checkbox", "aria-label": `Chọn ${w.word}`, checked: state.selected.has(w.id) ? true : null,
    onChange: () => toggle(w.id, input.checked),
  });
  input.dataset.id = w.id;
  return h("label", { class: "check" }, input);
}

function toggle(id, on) {
  if (on) state.selected.add(id);
  else state.selected.delete(id);
  state.container.querySelector(`[data-row="${id}"]`)?.classList.toggle("is-selected", on);
  renderBulk();
  syncSelectAll();
}

function renderTable(host, words) {
  const all = h("input", { type: "checkbox", "aria-label": "Chọn tất cả", onChange: (e) => selectAll(words, e.target.checked) });
  state.refs.selectAll = all;
  const table = h("table", { class: "vocab-table" },
    h("thead", {}, h("tr", {},
      h("th", { class: "col-check" }, h("label", { class: "check" }, all)),
      h("th", { scope: "col" }, "Từ"), h("th", { scope: "col" }, "Nghĩa"), h("th", { scope: "col" }, "Nguồn"),
      h("th", { scope: "col" }, "Hộp"), h("th", { scope: "col", class: "nowrap" }, "Ôn tới"))),
    h("tbody", {}, words.map((w) => h("tr", { dataset: { row: w.id }, class: state.selected.has(w.id) ? "is-selected" : "" },
      h("td", { class: "col-check" }, checkbox(w)),
      h("td", { class: "col-word" }, h("div", { class: "word-cell" },
        h("button", { type: "button", class: "link-btn", onClick: () => openPanel(w.id) }, w.word),
        speakButton(w.word))),
      h("td", { class: "col-meaning" }, meaningText(w), " ", pendingTag(w)),
      h("td", { class: "col-source" }, sourceText(w)),
      h("td", { class: "col-box nowrap" }, h("span", { class: "chip" }, `H${w.box}`)),
      h("td", { class: `col-next nowrap${isDue(w) ? " is-due" : ""}` }, nextReviewText(w))))));
  host.replaceChildren(h("div", { class: "table-scroll" }, table));
  syncSelectAll();
}

function renderCards(host, words) {
  state.refs.selectAll = null;
  host.replaceChildren(h("ul", { class: "vocab-cards" }, words.map((w) => h("li", { class: `vocab-card${state.selected.has(w.id) ? " is-selected" : ""}`, dataset: { row: w.id } },
    checkbox(w),
    h("div", { class: "vocab-card-main" },
      h("div", { class: "word-cell" },
        h("button", { type: "button", class: "link-btn", onClick: () => openPanel(w.id) }, w.word),
        speakButton(w.word)),
      h("p", { class: "vocab-card-meaning" }, meaningText(w), " ", pendingTag(w)),
      h("p", { class: "vocab-card-meta" }, sourceText(w), h("span", { class: "chip" }, `H${w.box}`),
        h("span", { class: `nowrap${isDue(w) ? " is-due" : ""}` }, nextReviewText(w))))))));
}

function selectAll(words, on) {
  for (const w of words) {
    if (on) state.selected.add(w.id);
    else state.selected.delete(w.id);
  }
  renderList();
  renderBulk();
}

function syncSelectAll() {
  const el = state.refs.selectAll;
  if (!el) return;
  const words = filtered();
  const n = words.filter((w) => state.selected.has(w.id)).length;
  el.checked = words.length > 0 && n === words.length;
  el.indeterminate = n > 0 && n < words.length;
}

function renderList() {
  const host = state.refs.list;
  const words = filtered();
  state.refs.shown = words;
  renderStats(words.length);
  if (state.data.vocab.length === 0) {
    host.replaceChildren(h("p", { class: "empty-state" }, "Chưa có từ nào. Nhấn N hoặc nút Ghi nhanh để thêm từ đầu tiên."));
  } else if (words.length === 0) {
    host.replaceChildren(h("p", { class: "empty-state" }, "Không có từ nào khớp bộ lọc."));
  } else if (phone.matches) {
    renderCards(host, words);
  } else {
    renderTable(host, words);
  }
}

function renderStats(shown) {
  const { vocab } = state.data;
  const due = vocab.filter((w) => isDue(w)).length;
  const pending = vocab.filter((w) => !w.enriched).length;
  const filteredOn = shown !== vocab.length;
  const parts = [
    h("span", { class: "nowrap" }, `Tổng ${vocab.length} từ`), " · ",
    h("span", { class: "nowrap" }, `Đến hạn ${due}`), " · ",
    h("span", { class: "nowrap" }, `Chờ hoàn thiện ${pending}`),
  ];
  if (filteredOn) parts.push(h("span", { class: "muted nowrap" }, ` · Đang hiện ${shown}`));
  state.refs.stats.replaceChildren(...parts); // never pass null here: replaceChildren turns it into the text "null"
  state.refs.review.firstChild.textContent = `Ôn ngay (${due} đến hạn)`;
  state.refs.enrich.textContent = `Hoàn thiện với Claude (${pending})`;
  state.refs.enrich.disabled = pending === 0;
}

// ---- Bulk actions ----
function selectedWords() {
  return state.data.vocab.filter((w) => state.selected.has(w.id));
}

function renderBulk() {
  const host = state.refs.bulk;
  const n = state.selected.size;
  host.hidden = n === 0;
  if (n === 0) return;
  host.replaceChildren(
    h("span", { class: "bulk-count nowrap" }, `${n} đã chọn`),
    h("button", { type: "button", class: "btn btn-outline btn-sm", dataset: { role: "enrich-selected" }, onClick: () => openEnrich("vocab", { selectedIds: [...state.selected].slice(0, 20) }) },
      `Hoàn thiện ${Math.min(n, 20)} từ với Claude`),
    h("button", { type: "button", class: "btn btn-outline btn-sm", onClick: onLearned }, "Đánh dấu đã thuộc"),
    h("button", { type: "button", class: "btn btn-outline btn-sm", onClick: exportCsv }, `Xuất CSV (${n})`),
    h("button", { type: "button", class: "btn btn-danger btn-sm", onClick: onDelete }, "Xoá"),
    h("button", { type: "button", class: "btn btn-text btn-sm", onClick: () => { state.selected.clear(); renderList(); renderBulk(); } }, "Bỏ chọn"));
}

async function onLearned() {
  const ids = [...state.selected];
  const n = await markLearned(ids);
  showToast(`Đã đánh dấu ${n} từ là đã thuộc (hộp 5).`);
  await reload();
}

async function onDelete() {
  const ids = [...state.selected];
  const ok = await confirmModal({
    title: "Xoá từ", danger: true, confirmLabel: `Xoá ${ids.length} từ`,
    message: `Xoá ${ids.length} từ đã chọn? Việc này không thể hoàn tác từ trong ứng dụng (hãy sao lưu trước nếu cần).`,
  });
  if (!ok) return;
  const n = await deleteVocab(ids);
  state.selected.clear();
  showToast(`Đã xoá ${n} từ.`);
  await reload();
}

// Selected words, or everything that matches the current filters when nothing is selected.
function exportCsv() {
  const words = state.selected.size ? selectedWords() : filtered();
  if (words.length === 0) {
    showToast("Không có từ nào để xuất.", "error");
    return;
  }
  downloadText(`elh-vocab-${isoDate()}.csv`, vocabCsv(words), "text/csv;charset=utf-8");
  showToast(`Đã xuất ${words.length} từ.`);
}

// ---- Word panel ----
function panelContext(id) {
  const word = state.data.vocab.find((w) => w.id === id);
  if (!word) return null;
  return buildVocabDetail(
    {
      word, occurrences: state.data.occurrences.filter((o) => o.itemId === id), topics: topicsList(),
      notes: notesFor(state.data.notes ?? [], "vocab", id), notebooks: state.data.notebooks ?? [],
    },
    {
      async save(fields) {
        const conflict = await findConflict(id, { lemma: fields.lemma || fields.word, pos: fields.pos });
        if (conflict) return { conflict };
        await updateVocab(id, fields);
        showToast("Đã lưu thay đổi.");
        await reload();
        return {};
      },
      async merge(keepId) {
        const keep = state.data.vocab.find((w) => w.id === keepId);
        const ok = await confirmModal({
          title: "Gộp thẻ từ", confirmLabel: "Gộp",
          message: `Gộp thẻ "${word.word}" vào thẻ "${keep?.word}"? Ngữ cảnh, collocations và lần xuất hiện được giữ lại. Thay đổi chưa lưu trong biểu mẫu sẽ không được giữ.`,
        });
        if (!ok) return;
        await mergeVocab(keepId, id);
        closePanel();
        showToast("Đã gộp hai thẻ từ.");
        await reload();
      },
      async remove() {
        const ok = await confirmModal({ title: "Xoá từ", danger: true, confirmLabel: "Xoá", message: `Xoá từ "${word.word}"?` });
        if (!ok) return;
        await deleteVocab([id]);
        closePanel();
        showToast("Đã xoá từ.");
        await reload();
      },
    });
}

function openPanel(id) {
  const detail = panelContext(id);
  if (!detail) return;
  state.panelId = id;
  if (state.sheet?.isOpen()) {
    state.sheet.setHeader({ title: detail.title, badge: detail.badge });
    state.sheet.setContent(detail.node);
    return;
  }
  const sheet = openSheet({
    title: detail.title, badge: detail.badge, content: detail.node,
    onClose: () => { if (state.sheet === sheet) { state.sheet = null; state.panelId = null; } },
  });
  state.sheet = sheet;
}

function closePanel() {
  if (state.sheet?.isOpen()) state.sheet.close();
  state.sheet = null;
  state.panelId = null;
}

// ---- Filters ----
function renderFilterOptions() {
  const { source, topic } = state.refs;
  const counts = new Map();
  for (const d of state.derived.values()) {
    for (const k of new Set(d.sources.map((s) => `b${s.book}`))) counts.set(k, (counts.get(k) ?? 0) + 1);
    for (const sk of ["W", "S"]) if (d.sources.some((s) => s.skill === sk)) counts.set(sk, (counts.get(sk) ?? 0) + 1);
  }
  const opt = (value, label, selected) => h("option", { value, selected: selected ? true : null }, label);
  source.replaceChildren(
    opt("", "Mọi nguồn", state.filters.source === ""),
    ...[...BOOKS].reverse().map((b) => opt(String(b), `Cam ${b} (${counts.get(`b${b}`) ?? 0})`, state.filters.source === String(b))),
    opt("W", `Writing (${counts.get("W") ?? 0})`, state.filters.source === "W"),
    opt("S", `Speaking (${counts.get("S") ?? 0})`, state.filters.source === "S"));
  const topics = topicsList();
  if (state.filters.topic && state.filters.topic !== NO_TOPIC && !topics.includes(state.filters.topic)) state.filters.topic = "";
  topic.replaceChildren(
    opt("", "Mọi chủ đề", state.filters.topic === ""),
    ...topics.map((t) => opt(t, t, state.filters.topic === t)),
    opt(NO_TOPIC, "Chưa phân loại", state.filters.topic === NO_TOPIC));
}

function buildFilters() {
  const f = state.filters;
  const search = h("input", { class: "input", type: "search", placeholder: "Tìm từ, nghĩa, collocation, ngữ cảnh…", "aria-label": "Tìm kiếm", autocomplete: "off", value: f.q });
  search.addEventListener("input", () => { f.q = search.value; renderList(); });
  const source = h("select", { class: "input", "aria-label": "Lọc theo nguồn" });
  source.addEventListener("change", () => { f.source = source.value; renderList(); });
  const topic = h("select", { class: "input", "aria-label": "Lọc theo chủ đề" });
  topic.addEventListener("change", () => { f.topic = topic.value; renderList(); });
  state.refs.source = source;
  state.refs.topic = topic;

  const chip = (label, pressed, onClick) => {
    const b = h("button", { type: "button", class: "chip-btn nowrap", "aria-pressed": String(pressed), onClick: () => { onClick(); b.setAttribute("aria-pressed", String(pressed = !pressed)); renderList(); } }, label);
    return b;
  };
  const boxes = [1, 2, 3, 4, 5].map((n) => chip(`H${n}`, f.boxes.has(n), () => { if (f.boxes.has(n)) f.boxes.delete(n); else f.boxes.add(n); }));
  const pending = chip("Chờ hoàn thiện", f.pending, () => { f.pending = !f.pending; });
  const due = chip("Đến hạn", f.due, () => { f.due = !f.due; });

  return h("div", { class: "vocab-filters" },
    h("div", { class: "vocab-search" }, search),
    h("div", { class: "vocab-selects" }, source, topic),
    h("div", { class: "chip-group", role: "group", "aria-label": "Lọc theo hộp Leitner" }, boxes, due, pending));
}

// ---- Lifecycle ----
async function reload() {
  state.data = await loadVocabData();
  if (!state.active) return;
  derive();
  renderFilterOptions();
  renderList();
  renderBulk();
  if (state.panelId) {
    if (state.data.vocab.some((w) => w.id === state.panelId)) openPanel(state.panelId);
    else closePanel();
  }
}

phone.addEventListener("change", () => { if (state.active && state.data) renderList(); });
document.addEventListener("elh:data-changed", () => { if (state.active) reload().catch(() => {}); });

export const vocabView = {
  mount(container, _params, query = {}) {
    state.active = true;
    state.container = container;
    state.data = null;
    state.selected.clear();
    // Filters start clean on every visit; the Dashboard can ask for one, e.g. #/vocab?due=1
    state.filters = { q: "", source: "", topic: "", boxes: new Set(), pending: query.pending === "1", due: query.due === "1" };
    const token = ++state.token;

    state.refs.stats = h("p", { class: "vocab-stats" }, "Đang tải…");
    state.refs.list = h("div", { class: "vocab-list" });
    state.refs.bulk = h("div", { class: "bulk-bar", hidden: true });
    state.refs.enrich = h("button", { type: "button", class: "btn btn-outline", dataset: { role: "enrich-open" }, onClick: () => openEnrich("vocab") }, "Hoàn thiện với Claude");
    state.refs.review = h("a", { class: "btn btn-outline", href: "#/warmup" }, "Ôn ngay (0 đến hạn)");

    container.replaceChildren(h("div", { class: "vocab" },
      h("div", { class: "vocab-head" },
        h("div", {}, h("h1", { class: "page-title" }, "Vocabulary Bank"), state.refs.stats),
        h("div", { class: "vocab-actions" },
          h("button", { type: "button", class: "btn btn-primary", onClick: () => openQuickCapture({ tab: "word" }) }, "+ Thêm từ"),
          state.refs.review,
          state.refs.enrich,
          h("button", { type: "button", class: "btn btn-outline", onClick: exportCsv }, "Xuất CSV"))),
      buildFilters(),
      state.refs.bulk,
      state.refs.list));

    loadVocabData().then((data) => {
      if (token !== state.token) return;
      state.data = data;
      derive();
      renderFilterOptions();
      renderList();
    }).catch((err) => {
      if (token !== state.token) return;
      state.refs.list.replaceChildren(h("p", { class: "form-error" }, `Không đọc được dữ liệu: ${err.message}`));
    });
  },

  unmount() {
    state.active = false;
    state.token++;
    closePanel();
  },
};
