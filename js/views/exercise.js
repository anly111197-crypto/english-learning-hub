// Exercise screen (spec 5.8, step 8c): one question at a time, marked on this device, then the result.
// Every answer is stored at once (services/exercise-ops.js), so the exercise can be left and continued.
import { h } from "../components/dom.js";
import { showToast } from "../components/toast.js";
import { errorTypeLabel } from "../services/taxonomy.js";
import { loadExerciseData, loadExercise, saveItem, finishExercise, markFixedAfterExercise } from "../services/exercise-ops.js";
import { gradeItem, applySelfGrade, nextItemIndex, isExerciseComplete, KIND_LABELS, scoreOf, errorLabel } from "../services/exercise.js";

let s = null;

const optionKeys = ["1", "2", "3", "4"];
const errorOf = (errorId) => s.errors.get(errorId);

function frame(...children) {
  const total = s.ex.items.length;
  const shown = s.phase === "result" ? total : Math.min(s.idx + 1, total);
  return h("div", { class: "ex", dataset: { phase: s.phase } },
    h("div", { class: "ex-head" },
      h("a", { class: "btn btn-text", href: "#/errors", dataset: { role: "ex-back" } }, "← Sổ lỗi"),
      h("h1", { class: "ex-title" }, "Bài tập từ lỗi"),
      s.phase === "result" ? null : h("span", { class: "ex-progress nowrap", dataset: { role: "ex-progress" } }, `Câu ${shown}/${total}`)),
    s.phase === "result" ? null : h("div", { class: "bar ex-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(total), "aria-valuenow": String(s.idx) },
      h("div", { class: "bar-fill", style: `width:${Math.round((s.idx / total) * 100)}%` })),
    ...children);
}

// ---- One question ----
function questionCard() {
  const item = s.ex.items[s.idx];
  const err = errorOf(item.errorId);
  const answering = s.phase === "answer";
  const done = item.userAnswer !== null && item.userAnswer !== undefined;

  let input;
  s.refs = {};
  if (item.kind === "choose") {
    s.choice = done ? item.userAnswer : s.choice ?? null;
    input = h("div", { class: "ex-options", role: "radiogroup", "aria-label": "Các lựa chọn", tabindex: "-1" },
      item.options.map((opt, i) => {
        const picked = s.choice === opt;
        const state = done ? (opt === item.answer ? "right" : picked ? "wrong" : "") : "";
        return h("button", {
          type: "button", class: "ex-option", role: "radio", "aria-checked": String(picked), disabled: !answering,
          dataset: { role: "ex-option", index: String(i), state, picked: String(picked) },
          onClick: () => { s.choice = opt; for (const b of s.refs.optionBtns) { const on = b.dataset.index === String(i); b.setAttribute("aria-checked", String(on)); b.dataset.picked = String(on); } s.refs.submit.disabled = false; },
        }, h("span", { class: "ex-option-key" }, optionKeys[i]), h("span", { class: "ex-option-text" }, opt));
      }));
    s.refs.optionBtns = [];
    s.refs.optionsBox = input;
  } else {
    const area = item.kind !== "fill";
    input = h(area ? "textarea" : "input", {
      class: `input${area ? " textarea ex-textarea" : ""}`, ...(area ? { rows: item.kind === "rewrite" ? "3" : "2" } : { type: "text" }),
      dataset: { role: "ex-input" }, "aria-label": "Câu trả lời của bạn", autocomplete: "off", autocapitalize: "off", spellcheck: "false", disabled: !answering,
      placeholder: item.kind === "correct" ? "Gõ lại cả câu đã sửa (hoặc chỉ phần bạn sửa)" : item.kind === "rewrite" ? "Viết lại câu" : "Điền vào chỗ trống",
    });
    input.value = done ? item.userAnswer : "";
    input.addEventListener("input", () => { s.refs.submit.disabled = !input.value.trim(); });
    s.refs.input = input;
  }

  const submit = h("button", { type: "button", class: "btn btn-primary", dataset: { role: "ex-submit" }, hidden: !answering, disabled: item.kind === "choose" ? s.choice === null : true, onClick: submitAnswer }, "Nộp (Enter)");
  s.refs.submit = submit;
  const card = h("section", { class: "ex-card", dataset: { kind: item.kind, id: item.id } },
    h("p", { class: "ex-meta" },
      h("span", { class: "chip nowrap", dataset: { role: "ex-kind" } }, KIND_LABELS[item.kind]),
      h("span", { class: "chip chip-type nowrap" }, err ? errorTypeLabel(err.type) : "Lỗi đã xoá")),
    item.kind === "correct"
      ? h("blockquote", { class: "ex-sentence", dataset: { role: "ex-question" } }, item.question)
      : h("p", { class: "ex-question", dataset: { role: "ex-question" } }, item.question),
    input, submit,
    answering ? null : feedbackBox(item));
  if (item.kind === "choose") s.refs.optionBtns = [...card.querySelectorAll("[data-role=ex-option]")];
  return card;
}

function feedbackBox(item) {
  const g = gradeItem(item, item.userAnswer);
  const pending = item.correct === null || item.correct === undefined;
  const right = item.correct === true;
  const last = s.idx === s.ex.items.length - 1;
  const explanation = h("p", { class: "ex-explain", hidden: !s.showExplain, dataset: { role: "ex-explain" } }, item.explanationVi);
  const toggle = (label) => h("button", {
    type: "button", class: "btn btn-outline btn-sm", dataset: { role: "ex-hint" },
    onClick: () => { s.showExplain = !s.showExplain; explanation.hidden = !s.showExplain; },
  }, label);

  const parts = [];
  if (pending) {
    parts.push(
      h("p", { class: "ex-verdict", dataset: { role: "ex-verdict" } }, "Chưa khớp đáp án mẫu."),
      h("p", { class: "ex-answer" }, h("strong", {}, "Đáp án mẫu: "), item.answer),
      (item.acceptedAnswers ?? []).length ? h("p", { class: "ex-accepted muted" }, `Cũng đúng: ${item.acceptedAnswers.join(" · ")}`) : null,
      h("p", { class: "ex-yours" }, h("strong", {}, "Bạn viết: "), item.userAnswer),
      h("p", { class: "ex-ask" }, "Câu của bạn có đúng ý và đúng ngữ pháp không?"),
      h("div", { class: "ex-actions" },
        h("button", { type: "button", class: "btn btn-primary", dataset: { role: "ex-self-yes" }, onClick: () => selfGrade(true) }, "Đúng ý"),
        h("button", { type: "button", class: "btn btn-outline", dataset: { role: "ex-self-no" }, onClick: () => selfGrade(false) }, "Sai")));
  } else if (right) {
    parts.push(
      h("p", { class: "ex-verdict", dataset: { role: "ex-verdict", result: "right" } }, "Đúng",
        g.matched === "span" ? " (bạn gõ đúng phần đã sửa)" : "", item.selfGraded ? " (bạn tự chấm)" : ""),
      h("div", { class: "ex-actions" }, toggle("Xem giải thích")), explanation);
  } else {
    parts.push(
      h("p", { class: "ex-verdict", dataset: { role: "ex-verdict", result: "wrong" } }, "Sai",
        item.selfGraded ? " (bạn tự chấm)" : ""),
      h("p", { class: "ex-answer" }, h("strong", {}, "Đáp án: "), item.answer),
      (item.acceptedAnswers ?? []).length ? h("p", { class: "ex-accepted muted" }, `Cũng đúng: ${item.acceptedAnswers.join(" · ")}`) : null,
      item.kind !== "choose" ? h("p", { class: "ex-yours" }, h("strong", {}, "Bạn viết: "), item.userAnswer) : null,
      h("div", { class: "ex-actions" },
        toggle("Gợi ý"),
        g.selfGrade === "override" && !item.selfGraded
          ? h("button", { type: "button", class: "btn btn-outline btn-sm", dataset: { role: "ex-override" }, onClick: () => selfGrade(true) }, "Tôi đúng ý")
          : null),
      explanation);
  }
  parts.push(h("div", { class: "ex-actions ex-next-row" },
    h("button", { type: "button", class: "btn btn-primary", dataset: { role: "ex-next" }, disabled: pending, onClick: next }, last ? "Xem kết quả (Enter)" : "Câu tiếp (Enter)")));
  return h("div", { class: "ex-feedback", role: "status", dataset: { role: "ex-feedback", result: pending ? "pending" : right ? "right" : "wrong" } }, ...parts.filter(Boolean));
}

async function submitAnswer() {
  if (s.busy || s.phase !== "answer") return;
  const item = s.ex.items[s.idx];
  const raw = item.kind === "choose" ? s.choice : s.refs.input?.value ?? "";
  if (raw === null || raw === undefined || !String(raw).trim()) {
    showToast(item.kind === "choose" ? "Hãy chọn một đáp án." : "Hãy nhập câu trả lời.", "error");
    return;
  }
  s.busy = true;
  const g = gradeItem(item, raw);
  try {
    s.ex = await saveItem(s.id, s.idx, { userAnswer: String(raw).trim(), correct: g.correct, selfGraded: false });
    s.phase = "feedback";
    s.showExplain = false;
    render();
    (s.root.querySelector("[data-role=ex-next]:not([disabled])") ?? s.root.querySelector("[data-role=ex-self-yes]"))?.focus();
  } catch (e) {
    showToast(e.message || "Không lưu được câu trả lời.", "error");
  } finally {
    s.busy = false;
  }
}

async function selfGrade(ok) {
  if (s.busy) return;
  s.busy = true;
  try {
    const marked = applySelfGrade(s.ex.items[s.idx], ok);
    s.ex = await saveItem(s.id, s.idx, { correct: marked.correct, selfGraded: true });
    render();
    s.root.querySelector("[data-role=ex-next]")?.focus();
  } catch (e) {
    showToast(e.message || "Không lưu được.", "error");
  } finally {
    s.busy = false;
  }
}

async function next() {
  if (s.busy || s.phase !== "feedback") return;
  const item = s.ex.items[s.idx];
  if (item.correct === null || item.correct === undefined) return; // a rewrite waits for the learner's own mark
  if (isExerciseComplete(s.ex)) { await showResult(); return; }
  s.idx = nextItemIndex(s.ex);
  s.phase = "answer";
  s.choice = null;
  s.showExplain = false;
  render();
  (s.refs.input ?? s.refs.optionsBox)?.focus(); // not an option button: Enter must submit, not select
}

// ---- Result ----
async function showResult() {
  s.busy = true;
  try {
    const res = await finishExercise(s.id);
    s.ex = res.exercise;
    s.result = res;
    s.errors = new Map((await loadExerciseData()).errors.map((e) => [e.id, e]));
    s.phase = "result";
    render();
    document.dispatchEvent(new CustomEvent("elh:data-changed")); // the exercise and the warm-up priority are new data
  } catch (e) {
    showToast(e.message || "Không tính được kết quả.", "error");
  } finally {
    s.busy = false;
  }
}

function resultView() {
  const { perError, suggestFixed } = s.result;
  const total = s.ex.items.length;
  const cards = perError.map((p) => {
    const err = errorOf(p.errorId);
    const items = s.ex.items.filter((it) => it.errorId === p.errorId);
    const suggest = suggestFixed.includes(p.errorId) && !s.fixedNow.has(p.errorId);
    return h("article", { class: "ex-result-card", dataset: { id: p.errorId, score: `${p.correct}/${p.total}` } },
      h("div", { class: "ex-result-head" },
        h("p", { class: "ex-result-title" }, err ? errorLabel(err) : "Lỗi đã xoá"),
        h("strong", { class: "ex-result-score nowrap", dataset: { role: "ex-error-score" } }, `${p.correct}/${p.total}`)),
      h("ul", { class: "ex-result-items" }, items.map((it) => h("li", { class: "ex-result-item", dataset: { correct: String(it.correct === true) } },
        h("span", { class: "ex-result-mark", "aria-hidden": "true" }, it.correct === true ? "✓" : "✗"),
        h("span", { class: "ex-result-text" }, `${KIND_LABELS[it.kind]}: ${it.userAnswer ?? ""}`, it.selfGraded ? " (tự chấm)" : "")))),
      s.fixedNow.has(p.errorId)
        ? h("p", { class: "ex-fixed", dataset: { role: "ex-fixed-done" } }, "Đã đánh dấu là đã khắc phục.")
        : suggest
          ? h("div", { class: "ex-suggest", dataset: { role: "ex-suggest" } },
            h("p", {}, "Bạn làm đúng cả 3 câu. Đánh dấu lỗi này là đã khắc phục?"),
            h("button", { type: "button", class: "btn btn-primary btn-sm", dataset: { role: "ex-mark-fixed", id: p.errorId }, onClick: () => markFixed(p.errorId) }, "Đánh dấu đã khắc phục"))
          : p.correct < p.total
            ? h("p", { class: "ex-priority muted", dataset: { role: "ex-priority" } }, "Lỗi này sẽ được ưu tiên ôn trong khởi động 15'.")
            : null);
  });
  return h("div", { class: "ex-result" },
    h("section", { class: "ex-score", dataset: { role: "ex-score" } },
      h("p", { class: "ex-score-label" }, "Kết quả"),
      h("p", { class: "ex-score-value nowrap" }, `Đúng ${scoreOf(s.ex)}/${total}`)),
    h("div", { class: "ex-result-list" }, ...cards),
    h("div", { class: "ex-actions" },
      h("a", { class: "btn btn-primary", href: "#/errors", dataset: { role: "ex-to-notebook" } }, "Về Grammar Notebook"),
      h("a", { class: "btn btn-outline", href: "#/warmup" }, "Khởi động 15'")));
}

async function markFixed(errorId) {
  if (s.busy) return;
  s.busy = true;
  try {
    await markFixedAfterExercise([errorId]);
    s.fixedNow.add(errorId);
    s.errors = new Map((await loadExerciseData()).errors.map((e) => [e.id, e]));
    render();
    document.dispatchEvent(new CustomEvent("elh:data-changed"));
    showToast("Đã đánh dấu lỗi là đã khắc phục.");
  } catch (e) {
    showToast(e.message || "Không đánh dấu được.", "error");
  } finally {
    s.busy = false;
  }
}

// ---- Page ----
function render() {
  s.root = s.phase === "result" ? frame(resultView()) : frame(questionCard());
  s.container.replaceChildren(s.root);
}

function onKeydown(e) {
  if (!s || document.body.hasAttribute("data-overlay-open") || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  const t = e.target instanceof Element ? e.target : document.body;
  const typing = Boolean(t.closest("input, textarea, select"));
  if (s.phase === "answer") {
    const item = s.ex.items[s.idx];
    if (e.key === "Enter") {
      if (t.closest("textarea") && e.shiftKey) return; // a new line in a rewrite
      if (t.closest(".ex-option") && s.choice !== null && t.closest(".ex-option").dataset.picked === "true") { e.preventDefault(); submitAnswer(); return; } // Enter on the chosen option submits
      if (t.closest("button, a")) return;
      e.preventDefault();
      submitAnswer();
    } else if (item.kind === "choose" && !typing && optionKeys.includes(e.key)) {
      const btn = s.refs.optionBtns?.[Number(e.key) - 1];
      if (btn) { e.preventDefault(); btn.click(); }
    }
  } else if (s.phase === "feedback" && e.key === "Enter" && !t.closest("button, a")) {
    e.preventDefault();
    next();
  }
}

async function start(container, params) {
  const x = { id: params.id, container, ex: null, errors: new Map(), idx: 0, phase: "answer", choice: null, showExplain: false, busy: false, result: null, fixedNow: new Set(), refs: {}, root: null };
  s = x;
  container.replaceChildren(h("p", { class: "muted" }, "Đang tải…"));
  try {
    const [ex, data] = await Promise.all([loadExercise(params.id), loadExerciseData()]);
    if (s !== x) return;
    if (!ex || ex.deleted) {
      container.replaceChildren(h("p", { class: "form-error" }, "Không tìm thấy bài tập này."), h("a", { class: "btn btn-outline", href: "#/errors" }, "Về Grammar Notebook"));
      return;
    }
    x.ex = ex;
    x.errors = new Map(data.errors.map((e) => [e.id, e]));
  } catch (err) {
    if (s === x) container.replaceChildren(h("p", { class: "form-error" }, `Không đọc được dữ liệu: ${err.message}`));
    return;
  }
  if (isExerciseComplete(x.ex)) {
    await showResult();
  } else {
    x.idx = nextItemIndex(x.ex);
    const item = x.ex.items[x.idx];
    x.phase = item.userAnswer !== null && item.userAnswer !== undefined ? "feedback" : "answer"; // a rewrite waiting for the learner's mark
    render();
    if (x.phase === "answer") (x.refs.input ?? x.refs.optionsBox)?.focus();
  }
  document.addEventListener("keydown", onKeydown);
}

function stop() {
  if (!s) return;
  document.removeEventListener("keydown", onKeydown);
  s = null;
}

export const exerciseView = {
  mount(container, params) {
    stop();
    start(container, params);
  },
  unmount: stop,
};
