// Quick capture (spec 5.4): FAB or key N opens a small form with two tabs, "Từ mới" and "Lỗi sai".
// Everything works from the keyboard: type, Enter saves and closes; Tab moves on; Alt+1 / Alt+2 switch tabs.
import { openModal } from "./modal.js";
import { showToast } from "./toast.js";
import { h, autoGrow } from "./dom.js";
import { saveWord, saveError, countPending } from "../services/capture.js";
import { openEnrich } from "./enrich-modal.js";
import { ERROR_TYPES, SKILL_LABELS, PART_OPTIONS, POS_OPTIONS } from "../services/taxonomy.js";
import { BOOKS, TESTS } from "../services/progress.js";
import { loadPracticeData } from "../services/practice-store.js";
import { nextTest } from "../services/next-test.js";
import { pickDefaultSource } from "../services/capture-source.js";

// The previous save is remembered (also across reloads, for 3 hours) so a run of captures on the same
// test needs the source set only once.
const LAST_KEY = "lastCapture";
const memory = { tab: "word", last: null }; // last = { source, at }

function readLast() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_KEY));
    if (saved?.source && Number.isFinite(saved.at)) return saved;
  } catch { /* storage unavailable or invalid */ }
  return memory.last;
}

function writeLast(source) {
  memory.last = source ? { source, at: Date.now() } : null;
  try {
    if (memory.last) localStorage.setItem(LAST_KEY, JSON.stringify(memory.last));
    else localStorage.removeItem(LAST_KEY);
  } catch { /* storage unavailable: the in-memory copy is enough */ }
}
let active = false; // a capture form is open (or opening)

// Source to pre-fill: the test whose panel is open; else the test of the previous save if it was within
// the last 3 hours; else the "next" test.
async function defaultSource() {
  const m = /^#\/practice\/(1\d)\/([1-4])$/.exec(location.hash);
  const panel = m ? { book: Number(m[1]), test: Number(m[2]) } : null;
  const last = readLast();
  const known = pickDefaultSource({ panel, last });
  if (known) return known;
  try {
    return pickDefaultSource({ next: nextTest(await loadPracticeData()) });
  } catch {
    return null;
  }
}

const option = (value, label, selected) => h("option", { value: String(value), selected: selected ? true : null }, label);

function sourceBlock(initial) {
  const book = h("select", { id: "qc-book", class: "input" },
    option("", "Không gắn test", !initial?.book),
    [...BOOKS].reverse().map((b) => option(b, `Cam ${b}`, initial?.book === b)));
  const test = h("select", { id: "qc-test", class: "input" },
    TESTS.map((t) => option(t, `Test ${t}`, initial?.test === t)));
  const skill = h("select", { id: "qc-skill", class: "input" },
    option("", "Chưa rõ", !initial?.skill),
    Object.entries(SKILL_LABELS).map(([k, label]) => option(k, label, initial?.skill === k)));
  const part = h("select", { id: "qc-part", class: "input" });

  const fillParts = (keep) => {
    const opts = PART_OPTIONS[skill.value] ?? [];
    part.replaceChildren(option("", "Chưa rõ", !keep), ...opts.map((p) => option(p.value, p.label, keep === p.value)));
  };
  const sync = () => {
    const none = book.value === "";
    test.disabled = none;
    skill.disabled = none;
    part.disabled = none || !skill.value;
  };
  fillParts(initial?.part ?? null);
  sync();
  book.addEventListener("change", sync);
  skill.addEventListener("change", () => { fillParts(null); sync(); });

  const field = (label, el, id) => h("div", { class: "field" }, h("label", { class: "field-label", for: id }, label), el);
  const node = h("div", { class: "source-block" },
    h("p", { class: "field-label" }, "Nguồn"),
    h("div", { class: "source-grid" },
      field("Cam", book, "qc-book"), field("Test", test, "qc-test"),
      field("Kỹ năng", skill, "qc-skill"), field("Phần", part, "qc-part")));

  const read = () => (book.value === ""
    ? null
    : { book: Number(book.value), test: Number(test.value), skill: skill.value || null, part: part.value ? Number(part.value) : null });
  return { node, read };
}

// source: preset { book, test, skill, part }. exact: use it as given (an empty part stays empty instead of being filled
// from the previous save). onClose: called after the sheet has closed (the practice screen gives focus back to its box).
export async function openQuickCapture({ source, tab, exact = false, onClose } = {}) {
  if (active) return;
  active = true;
  try {
    const base = source ?? (await defaultSource());
    const last = readLast()?.source ?? null;
    // Keep skill and part from the previous save only when it was the same test.
    const same = base && last && last.book === base.book && last.test === base.test;
    const initial = exact ? base ?? null : base ? { ...base, skill: base.skill ?? (same ? last.skill : null), part: base.part ?? (same ? last.part : null) } : null;
    buildForm(initial, tab ?? memory.tab, onClose);
  } catch (err) {
    active = false;
    showToast(err.message || "Không mở được Ghi nhanh.", "error");
  }
}

function buildForm(initialSource, initialTab, onClose) {
  const values = { word: "", context: "", wrong: "", right: "", type: "" };
  let tab = initialTab;
  let busy = false;

  const source = sourceBlock(initialSource);
  const tabs = h("div", { class: "seg", role: "tablist", "aria-label": "Loại ghi nhanh" });
  const fields = h("div", { class: "form-fields" });
  const error = h("p", { class: "form-error", role: "alert", hidden: true });

  const tabButtons = [["word", "Từ mới"], ["error", "Lỗi sai"]].map(([id, label], i) => h("button", {
    type: "button", class: "seg-btn", role: "tab", dataset: { tab: id }, title: `Alt+${i + 1}`,
    onClick: () => setTab(id, false),
    onKeydown: (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        setTab(id === "word" ? "error" : "word", true);
      }
    },
  }, label));
  tabs.append(...tabButtons);

  const textarea = (id, key, placeholder, { autofocus = false } = {}) => {
    const t = h("textarea", { id, class: "input textarea", rows: "1", placeholder, autofocus: autofocus ? true : null }, values[key]);
    t.addEventListener("input", () => { values[key] = t.value; });
    autoGrow(t);
    return t;
  };
  const field = (label, el, id) => h("div", { class: "field" }, h("label", { class: "field-label", for: id }, label), el);

  function render(focusField) {
    for (const b of tabButtons) {
      const on = b.dataset.tab === tab;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    if (tab === "word") {
      const word = h("input", { id: "qc-word", class: "input", type: "text", autocomplete: "off", autocapitalize: "none", spellcheck: "false",
        placeholder: "ví dụ: mitigate the impact", value: values.word, autofocus: true });
      word.addEventListener("input", () => { values.word = word.value; });
      fields.replaceChildren(
        field("Từ hoặc collocation", word, "qc-word"),
        field("Câu ngữ cảnh (không bắt buộc)", textarea("qc-ctx", "context", "Câu bạn gặp từ này"), "qc-ctx"));
    } else {
      const type = h("select", { id: "qc-type", class: "input" },
        option("", "Chưa rõ", values.type === ""),
        ERROR_TYPES.map((t) => option(t.slug, t.label, values.type === t.slug)));
      type.addEventListener("change", () => { values.type = type.value; });
      fields.replaceChildren(
        field("Câu sai", textarea("qc-wrong", "wrong", "Câu bạn viết hoặc nói sai", { autofocus: true }), "qc-wrong"),
        field("Câu đúng (nếu biết)", textarea("qc-right", "right", "Để trống nếu chưa biết"), "qc-right"),
        field("Nhóm lỗi", type, "qc-type"));
    }
    error.hidden = true;
    if (focusField) fields.querySelector("input, textarea")?.focus();
  }

  function setTab(next, keepFocusOnTab) {
    tab = next;
    memory.tab = next;
    render(!keepFocusOnTab);
    if (keepFocusOnTab) tabButtons.find((b) => b.dataset.tab === next)?.focus();
  }

  const fail = (message) => { error.textContent = message; error.hidden = false; };

  async function submit(targetId) {
    if (busy) return;
    busy = true;
    error.hidden = true;
    try {
      const src = source.read();
      let message;
      if (tab === "word") {
        const res = await saveWord({ text: values.word, sentence: values.context, source: src, targetId });
        if (res.status === "needs-choice") {
          showChoice(res.matches);
          return;
        }
        const n = await countPending();
        message = res.status === "created"
          ? `Đã lưu · ${n} mục chờ hoàn thiện`
          : `"${res.vocab.word}" đã có trong kho${res.contextAdded ? ", đã thêm ngữ cảnh" : ""} · ${n} mục chờ hoàn thiện`;
      } else {
        const res = await saveError({ original: values.wrong, corrected: values.right, type: values.type, source: src });
        const n = await countPending();
        message = res.status === "created"
          ? `Đã lưu · ${n} mục chờ hoàn thiện`
          : `Lỗi này đã có, đã tính thêm một lần gặp · ${n} mục chờ hoàn thiện`;
      }
      writeLast(src);
      modal.close();
      document.dispatchEvent(new CustomEvent("elh:data-changed"));
      // The button opens "Hoàn thiện với Claude" for the kind of item that was just saved (spec 5.4).
      showToast(message, "ok", { label: "Hoàn thiện với Claude", onClick: () => openEnrich(tab === "word" ? "vocab" : "error") });
    } catch (err) {
      fail(err.message || "Không lưu được.");
    } finally {
      busy = false;
    }
  }

  // The word exists with several parts of speech: let the learner pick the card (spec 6.5).
  function showChoice(matches) {
    const posName = (v) => POS_OPTIONS.find((p) => p.value === v.pos)?.label ?? (v.pos || "chưa rõ loại từ");
    const pick = (id) => { modal.setContent(formNode); modal.setFooter(footerNode); submit(id); };
    const back = h("button", { type: "button", class: "btn btn-text", onClick: () => { modal.setContent(formNode); modal.setFooter(footerNode); render(true); } }, "Quay lại");
    const choice = h("div", { class: "choice" },
      h("p", {}, `"${values.word.trim()}" đã có với nhiều loại từ. Thêm ngữ cảnh vào thẻ nào?`),
      h("div", { class: "choice-list" },
        matches.map((v) => h("button", { type: "button", class: "btn btn-outline", onClick: () => pick(v.id) }, `${v.word} (${posName(v)})`)),
        h("button", { type: "button", class: "btn btn-outline", onClick: () => pick(null) }, "Tạo thẻ mới (chưa rõ loại từ)")));
    modal.setContent(choice);
    modal.setFooter(h("div", { class: "modal-actions" }, back));
    choice.querySelector("button")?.focus();
  }

  const formNode = h("form", {
    class: "form", novalidate: true,
    onSubmit: (e) => { e.preventDefault(); submit(); },
    onKeydown: (e) => {
      const t = e.target;
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) {
        e.preventDefault();
        submit();
      } else if (e.altKey && (e.key === "1" || e.key === "2")) {
        e.preventDefault();
        setTab(e.key === "1" ? "word" : "error", false);
      }
    },
  }, tabs, fields, source.node, error);

  const footerNode = h("div", { class: "modal-actions" },
    h("button", { type: "button", class: "btn btn-text", onClick: () => modal.close() }, "Hủy"),
    h("button", { type: "button", class: "btn btn-primary", onClick: () => submit() }, "Lưu (Enter)"));

  const modal = openModal({ title: "Ghi nhanh", content: formNode, footer: footerNode, onClose: () => { active = false; onClose?.(); } });
  render(false);
  fields.querySelector("input, textarea")?.focus();
}

function onKeydown(e) {
  if (e.key !== "n" && e.key !== "N") return;
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || e.isComposing) return;
  const t = e.target;
  if (t instanceof Element && t.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
  if (document.body.hasAttribute("data-overlay-open") || document.body.dataset.route === "warmup") return;
  e.preventDefault(); // keep the "n" from being typed into the field that gets focus
  openQuickCapture();
}

export function initQuickCapture() {
  document.addEventListener("elh:quick-capture", () => openQuickCapture());
  document.addEventListener("keydown", onKeydown);
}
