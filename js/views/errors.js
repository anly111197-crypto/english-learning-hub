// Grammar Notebook (spec 5.8): cards, 10 groups, status filter, sort, search, error cards with details,
// edit panel, merge, bulk actions. Exercises come in Step 8.
import { h, icon, formatDateVi } from "../components/dom.js";
import { openSheet } from "../components/sheet.js";
import { openModal, confirmModal } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import { notesBlock } from "../components/notes-block.js";
import { loadErrorData, updateError, setStatus, mergeErrors, deleteErrors } from "../services/error-ops.js";
import { STATUS_LABELS, STATUSES, summarizeErrors, filterErrors, sortErrors, normalizeType } from "../services/errors.js";
import { ERROR_TYPES, errorTypeLabel, sourceLabel, SKILL_LABELS, partLabel } from "../services/taxonomy.js";
import { diffWords } from "../services/diff.js";
import { normalizeText } from "../services/dedupe.js";
import { isoDate } from "../services/leitner.js";
import { notesFor } from "../services/notebook-ops.js";
import { buildErrorEdit } from "./error-detail.js";

const state = {
  active: false,
  container: null,
  data: null, // { errors, occurrences, notes, notebooks }
  occBy: new Map(), // error id -> occurrence records, newest first
  filters: { type: null, status: "all", q: "", sort: "occurrences" },
  selected: new Set(),
  expanded: new Set(),
  sheet: null,
  panelId: null,
  token: 0,
  refs: {},
};

const live = () => state.data.errors.filter((e) => !e.deleted);

function derive() {
  state.occBy = new Map();
  for (const o of state.data.occurrences) {
    if (!state.occBy.has(o.itemId)) state.occBy.set(o.itemId, []);
    state.occBy.get(o.itemId).push(o);
  }
  for (const list of state.occBy.values()) {
    list.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  const ids = new Set(live().map((e) => e.id));
  for (const id of [...state.selected]) if (!ids.has(id)) state.selected.delete(id);
}

// ---- Top cards ----
function renderCards() {
  const s = summarizeErrors(live(), state.data.occurrences, isoDate());
  state.summary = s;
  const card = (label, value, sub) => h("section", { class: "summary-card" },
    h("p", { class: "summary-label", title: label }, label),
    h("p", { class: "summary-value nowrap" }, value),
    h("p", { class: "summary-sub" }, sub));
  state.refs.cards.replaceChildren(
    card("Tổng lỗi ghi nhận", `${s.total} lỗi`, `${s.typesUsed} nhóm · ${s.totalOccurrences} lần gặp`),
    card("Nhóm nhiều nhất", s.top ? s.top.label : "–", s.top ? `${s.top.count} lỗi · ${s.top.share}% tổng lỗi` : "Chưa có lỗi"),
    card("Đã khắc phục", `${s.fixed} lỗi`, `${s.fixedPct}% tổng lỗi`),
    card("Lặp lại báo động", String(s.alarm), "≥ 3 lần trong 14 ngày"));
}

// ---- Filters ----
function renderFilters() {
  const f = state.filters;
  const s = state.summary;
  const set = (patch) => {
    const focused = document.activeElement?.textContent;
    Object.assign(f, patch);
    renderFilters();
    renderList();
    [...state.refs.filters.querySelectorAll("button")].find((b) => b.textContent === focused)?.focus();
  };
  const chip = (label, pressed, onClick) => h("button", { type: "button", class: "chip-btn nowrap", "aria-pressed": String(pressed), onClick }, label);
  const types = [
    chip(`Tất cả ${s.total}`, f.type === null, () => set({ type: null })),
    ...ERROR_TYPES.map((t) => chip(`${t.label} ${s.byType[t.slug] ?? 0}`, f.type === t.slug, () => set({ type: t.slug }))),
    chip(`Chưa rõ ${s.byType[""] ?? 0}`, f.type === "", () => set({ type: "" })),
  ];
  const statuses = [["all", "Tất cả"], ["open", "Chưa khắc phục"], ...STATUSES.map((st) => [st, STATUS_LABELS[st]])]
    .map(([key, label]) => chip(label, f.status === key, () => set({ status: key })));

  const search = h("input", { class: "input", type: "search", placeholder: "Tìm câu sai, câu đúng, quy tắc…", "aria-label": "Tìm kiếm", autocomplete: "off", value: f.q });
  search.addEventListener("input", () => { f.q = search.value; renderList(); });
  const sort = h("select", { class: "input", "aria-label": "Sắp xếp" },
    h("option", { value: "occurrences", selected: f.sort === "occurrences" ? true : null }, "Sắp xếp: Số lần lặp"),
    h("option", { value: "recent", selected: f.sort === "recent" ? true : null }, "Sắp xếp: Gần nhất"));
  sort.addEventListener("change", () => { f.sort = sort.value; renderList(); });

  state.refs.filters.replaceChildren(
    h("div", { class: "chip-group", role: "group", "aria-label": "Lọc theo nhóm lỗi" }, types),
    h("div", { class: "filter-row" },
      h("div", { class: "chip-group", role: "group", "aria-label": "Lọc theo trạng thái" }, statuses),
      h("div", { class: "filter-search" }, search, sort)));
}

// ---- Error cards ----
function tokens(list, cls) {
  const nodes = [];
  list.forEach((t, i) => {
    if (i > 0) nodes.push(" ");
    nodes.push(t.changed ? h("span", { class: cls }, t.text) : t.text);
  });
  return nodes;
}

function historyItem(o, error) {
  const s = o.source;
  const where = [];
  if (s?.book && s?.test) where.push(h("a", { class: "link", href: `#/practice/${s.book}/${s.test}` }, `Cam ${s.book} · Test ${s.test}`));
  else if (o.sessionId) where.push("Khởi động 15'");
  else if (o.submissionId) where.push("Bài viết");
  else where.push("Không gắn test");
  if (s?.skill) where.push(` · ${SKILL_LABELS[s.skill]}${s.part ? " " + partLabel(s.skill, s.part) : ""}`);
  const other = normalizeText(o.sentence) && normalizeText(o.sentence) !== normalizeText(error.original);
  return h("li", {},
    h("span", { class: "nowrap" }, formatDateVi(o.date)), " · ", where,
    other ? h("span", { class: "muted" }, ` · “${o.sentence}”`) : null);
}

function expandedBody(e) {
  const occs = state.occBy.get(e.id) ?? [];
  return h("div", { class: "error-more" },
    h("h4", { class: "more-label" }, "Quy tắc"),
    e.explanationVi ? h("p", { class: "more-text" }, e.explanationVi) : h("p", { class: "muted" }, "Chưa có giải thích."),
    h("h4", { class: "more-label" }, "Ví dụ đúng"),
    e.correctExample ? h("p", { class: "more-text" }, e.correctExample) : h("p", { class: "muted" }, "Chưa có ví dụ."),
    h("h4", { class: "more-label" }, `Lịch sử các lần gặp (${occs.length})`),
    occs.length ? h("ul", { class: "history-list" }, occs.map((o) => historyItem(o, e))) : h("p", { class: "muted" }, "Chưa có bản ghi nào."),
    notesBlock(notesFor(state.data.notes, "error", e.id), state.data.notebooks),
    h("div", { class: "detail-actions" },
      h("button", { type: "button", class: "btn btn-outline btn-sm", onClick: () => openEdit(e.id) }, "Sửa lỗi"),
      h("button", { type: "button", class: "btn btn-outline btn-sm", onClick: () => openMerge(e.id) }, "Gộp với lỗi khác…")));
}

function errorCard(e) {
  const occs = state.occBy.get(e.id) ?? [];
  const latest = occs[0];
  const d = diffWords(e.original, e.corrected);
  const open = state.expanded.has(e.id);
  const checked = state.selected.has(e.id);

  const box = h("input", { type: "checkbox", "aria-label": "Chọn lỗi này", checked: checked ? true : null });
  box.addEventListener("change", () => {
    if (box.checked) state.selected.add(e.id);
    else state.selected.delete(e.id);
    card.classList.toggle("is-selected", box.checked);
    renderBulk();
  });

  const toggle = h("button", {
    type: "button", class: "btn btn-text btn-sm", "aria-expanded": String(open),
    onClick: () => {
      if (state.expanded.has(e.id)) state.expanded.delete(e.id);
      else state.expanded.add(e.id);
      renderList();
    },
  }, open ? "Thu gọn" : "Xem chi tiết");

  const card = h("article", { class: `error-card${checked ? " is-selected" : ""}`, dataset: { id: e.id } },
    h("div", { class: "error-head" },
      h("label", { class: "check" }, box),
      h("span", { class: "chip nowrap" }, `×${e.occurrences ?? 1}`),
      h("span", { class: "chip chip-type nowrap" }, errorTypeLabel(e.type)),
      h("span", { class: "status-tag nowrap", dataset: { status: e.status } }, STATUS_LABELS[e.status] ?? e.status),
      e.enriched ? null : h("span", { class: "tag nowrap" }, "Chờ hoàn thiện")),
    h("p", { class: "error-meta" },
      latest ? `${sourceLabel(latest.source)} · ` : "",
      h("span", { class: "nowrap" }, formatDateVi(latest?.date ?? e.lastSeen))),
    h("div", { class: "error-lines" },
      h("p", { class: `line line-wrong${e.corrected ? "" : " no-fix"}` }, icon("i-x-circle", "line-icon"), h("span", { class: "line-text" }, tokens(d.wrong, "tok-del"))),
      e.corrected
        ? h("p", { class: "line line-right" }, icon("i-check-circle", "line-icon"), h("span", { class: "line-text" }, tokens(d.right, "tok-ins")))
        : h("p", { class: "line line-none muted" }, "(chưa có câu đúng)")),
    h("div", { class: "error-actions" }, toggle,
      h("button", { type: "button", class: "btn btn-text btn-sm", onClick: () => openEdit(e.id) }, "Sửa")),
    open ? expandedBody(e) : null);
  return h("li", {}, card);
}

function renderList() {
  const f = state.filters;
  const all = live();
  const shown = sortErrors(filterErrors(all, { type: f.type, status: f.status, q: f.q }), f.sort);
  state.shown = shown;
  state.refs.count.textContent = `Đang hiện ${shown.length} / ${all.length} lỗi`;
  if (all.length === 0) {
    state.refs.list.replaceChildren(h("p", { class: "empty-state" }, "Chưa có lỗi nào. Nhấn N hoặc nút Ghi nhanh, chọn tab Lỗi sai để thêm lỗi đầu tiên."));
  } else if (shown.length === 0) {
    state.refs.list.replaceChildren(h("p", { class: "empty-state" }, "Không có lỗi nào khớp bộ lọc."));
  } else {
    state.refs.list.replaceChildren(h("ul", { class: "error-list" }, shown.map(errorCard)));
  }
  renderBulk();
}

// ---- Bulk bar and exercise column ----
function renderBulk() {
  const n = state.selected.size;
  state.refs.bulk.hidden = n === 0;
  state.refs.exercises.querySelector(".exercise-selected").textContent = n ? `Đã chọn ${n} lỗi.` : "Chưa chọn lỗi nào.";
  if (n === 0) return;
  const ids = [...state.selected];
  state.refs.bulk.replaceChildren(
    h("span", { class: "bulk-count nowrap" }, `${n} đã chọn`),
    h("button", { type: "button", class: "btn btn-outline btn-sm", onClick: async () => {
      const done = await setStatus(ids, "fixed");
      showToast(`Đã đánh dấu ${done} lỗi là đã khắc phục.`);
      await reload();
    } }, "Đánh dấu đã khắc phục"),
    h("button", { type: "button", class: "btn btn-outline btn-sm", disabled: true, title: "Có ở Bước 8" }, `Tạo bài tập từ ${n} lỗi`, h("span", { class: "btn-note" }, "Có ở Bước 8")),
    h("button", { type: "button", class: "btn btn-danger btn-sm", onClick: async () => {
      const ok = await confirmModal({ title: "Xoá lỗi", danger: true, confirmLabel: `Xoá ${n} lỗi`, message: `Xoá ${n} lỗi đã chọn? Việc này không thể hoàn tác từ trong ứng dụng (hãy sao lưu trước nếu cần).` });
      if (!ok) return;
      showToast(`Đã xoá ${await deleteErrors(ids)} lỗi.`);
      state.selected.clear();
      await reload();
    } }, "Xoá"),
    h("button", { type: "button", class: "btn btn-text btn-sm", onClick: () => { state.selected.clear(); renderList(); } }, "Bỏ chọn"));
}

// ---- Edit panel ----
function openEdit(id) {
  const error = state.data.errors.find((e) => e.id === id);
  if (!error) return;
  const detail = buildErrorEdit(error, {
    async save(fields) {
      await updateError(id, fields);
      showToast("Đã lưu thay đổi.");
      await reload();
    },
    merge: () => openMerge(id),
    async remove() {
      const ok = await confirmModal({ title: "Xoá lỗi", danger: true, confirmLabel: "Xoá", message: "Xoá lỗi này khỏi sổ?" });
      if (!ok) return;
      await deleteErrors([id]);
      closePanel();
      showToast("Đã xoá lỗi.");
      await reload();
    },
  });
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

// ---- Merge ----
function openMerge(dropId) {
  const drop = state.data.errors.find((e) => e.id === dropId);
  if (!drop) return;
  let target = null;
  const search = h("input", { class: "input", type: "search", placeholder: "Tìm lỗi đích…", "aria-label": "Tìm lỗi đích", autocomplete: "off" });
  const list = h("div", { class: "merge-list", role: "radiogroup", "aria-label": "Lỗi đích" });
  const confirmBtn = h("button", { type: "button", class: "btn btn-primary", disabled: true }, "Gộp vào lỗi đã chọn");

  function renderChoices() {
    const found = sortErrors(filterErrors(live().filter((e) => e.id !== dropId), { q: search.value }), "occurrences").slice(0, 30);
    list.replaceChildren(...(found.length ? found.map((e) => h("button", {
      type: "button", class: "merge-item", role: "radio", "aria-checked": String(target === e.id),
      onClick: () => { target = e.id; confirmBtn.disabled = false; renderChoices(); },
    }, h("span", { class: "merge-text" }, e.original),
      h("span", { class: "muted nowrap" }, `×${e.occurrences ?? 1} · ${errorTypeLabel(e.type)} · ${STATUS_LABELS[e.status]}`)))
      : [h("p", { class: "muted" }, "Không có lỗi nào khác.")]));
  }
  search.addEventListener("input", renderChoices);
  renderChoices();

  const content = h("div", { class: "merge" },
    h("p", {}, "Gộp lỗi này vào lỗi đích: cộng số lần gặp, chuyển lịch sử các lần gặp sang lỗi đích, rồi xoá lỗi này."),
    h("p", { class: "edit-wrong" }, drop.original),
    search, list);
  const footer = h("div", { class: "modal-actions" },
    h("button", { type: "button", class: "btn btn-text", onClick: () => modal.close() }, "Hủy"), confirmBtn);
  const modal = openModal({ title: "Gộp với lỗi khác", content, footer });
  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    try {
      const merged = await mergeErrors(target, dropId);
      modal.close();
      closePanel();
      state.expanded.delete(dropId);
      state.selected.delete(dropId);
      showToast(`Đã gộp. Lỗi đích hiện có ×${merged.occurrences} lần gặp.`);
      await reload();
    } catch (err) {
      confirmBtn.disabled = false;
      showToast(err.message || "Không gộp được.", "error");
    }
  });
  search.focus();
}

// ---- Lifecycle ----
async function reload() {
  state.data = await loadErrorData();
  if (!state.active) return;
  derive();
  renderCards();
  renderFilters();
  renderList();
  if (state.panelId) {
    if (state.data.errors.some((e) => e.id === state.panelId && !e.deleted)) openEdit(state.panelId);
    else closePanel();
  }
}

document.addEventListener("elh:data-changed", () => { if (state.active) reload().catch(() => {}); });

export const errorsView = {
  mount(container, _params, query = {}) {
    state.active = true;
    state.container = container;
    state.data = null;
    state.selected.clear();
    // Filters start clean on every visit; the Dashboard can ask for some, e.g. #/errors?type=tenses&status=open
    const type = query.type === "unknown" ? "" : ERROR_TYPES.some((t) => t.slug === query.type) ? query.type : null;
    const status = query.status === "open" || STATUSES.includes(query.status) ? query.status : "all";
    state.filters = { type, status, q: "", sort: "occurrences" };
    const token = ++state.token;

    state.refs.cards = h("div", { class: "summary-grid" });
    state.refs.filters = h("div", { class: "error-filters" });
    state.refs.count = h("p", { class: "muted list-count" }, "Đang tải…");
    state.refs.bulk = h("div", { class: "bulk-bar", hidden: true });
    state.refs.list = h("div", { class: "error-list-host" });
    state.refs.exercises = h("aside", { class: "exercise-col" },
      h("h2", { class: "exercise-title" }, "Bài tập từ lỗi đã chọn"),
      h("p", { class: "muted" }, "Chọn các lỗi trong danh sách để tạo bài tập điền, sửa và viết lại, rồi chấm."),
      h("p", { class: "exercise-selected" }, "Chưa chọn lỗi nào."),
      h("button", { type: "button", class: "btn btn-outline", disabled: true, title: "Có ở Bước 8" }, "Tạo bài tập", h("span", { class: "btn-note" }, "Có ở Bước 8")));

    container.replaceChildren(h("div", { class: "errors" },
      h("h1", { class: "page-title" }, "Grammar Notebook"),
      h("p", { class: "page-sub" }, "Các lỗi bạn đã ghi, gom theo nhóm và theo số lần lặp lại."),
      state.refs.cards, state.refs.filters,
      h("div", { class: "errors-layout" },
        h("div", { class: "errors-main" }, state.refs.count, state.refs.bulk, state.refs.list),
        state.refs.exercises)));

    loadErrorData().then((data) => {
      if (token !== state.token) return;
      state.data = data;
      derive();
      renderCards();
      renderFilters();
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
