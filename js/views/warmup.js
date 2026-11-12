// The 15-minute warm-up (#/warmup, full screen): step 1 vocabulary (10'), step 2 grammar (5'), summary.
// Everything is saved after each answer. Keys: Space flip/confirm, 1-3 rate a flashcard, 1-4 choose, Enter check/next.
import { h, icon } from "../components/dom.js";
import { showToast } from "../components/toast.js";
import { isoDate, pickDueCards, chooseKind, buildQuestion, outcomeMessage } from "../services/leitner.js";
import {
  STEP_LIMITS_MS, remainingMs, formatClock, afterQuestion, pickErrorQueue, summarizeSession, sessionWarmup, shouldSuggestFixed,
} from "../services/warmup.js";
import { loadWarmupData, reviewVocab, reviewError, saveSession, markErrorsFixed } from "../services/warmup-ops.js";
import { loadPracticeData } from "../services/practice-store.js";
import { nextTest } from "../services/next-test.js";
import { errorTypeLabel } from "../services/taxonomy.js";
import { renderVocabQuestion, renderErrorQuestion, renderMessage, renderSummary } from "./warmup-render.js";

const state = {};

function freshState() {
  Object.assign(state, {
    active: false, token: 0, container: null, main: null, headerHost: null, refs: {},
    phase: "loading", // loading | vocab | vocab-empty | errors | errors-empty | summary | failed
    data: null, today: isoDate(),
    deck: [], idx: 0, queue: [], eidx: 0,
    results: { vocab: [], errors: [] }, errorStates: new Map(), // error id -> { streak, status, original, corrected }
    sessionId: null, startedAt: 0, limitMs: 0, timeUp: false, answered: false,
    ui: null, timer: null, keyHandler: null,
  });
}
freshState();

// ?dev=1&clock=SECONDS shortens both step clocks so "time is up" can be tested.
function limitFor(step) {
  const q = new URLSearchParams(location.search);
  const secs = q.get("dev") === "1" ? Number(q.get("clock")) : NaN;
  return Number.isFinite(secs) && secs > 0 ? secs * 1000 : STEP_LIMITS_MS[step];
}

// ---- Header (one header for every screen, including the summary) ----
const step = () => (state.phase === "summary" ? 3 : state.phase.startsWith("errors") ? 2 : 1);
const inQuestion = () => state.phase === "vocab" || state.phase === "errors";

function buildHeader() {
  const s = step();
  const stepEl = (n, label, limit) => h("li", {
    class: "wu-step", "aria-current": s === n ? "step" : null, dataset: { done: s > n ? "true" : "false" },
  }, s > n ? icon("i-check-circle", "wu-step-icon") : null, label, h("span", { class: "muted" }, ` (${limit})`));

  const clock = h("span", { class: "wu-clock nowrap", "aria-label": "Thời gian còn lại" }, formatClock(state.limitMs || 0));
  const progress = h("span", { class: "wu-progress nowrap", "aria-label": "Tiến độ" });
  const skip = h("button", { type: "button", class: "btn btn-text wu-skip", onClick: onSkip }, "Bỏ qua");
  state.refs = { clock, progress, skip };

  const header = h("header", { class: "wu-header" },
    h("a", { class: "btn btn-text wu-exit", href: "#/" }, icon("i-arrow-left"), h("span", {}, "Thoát")),
    h("ol", { class: "wu-steps", "aria-label": "Các bước" }, stepEl(1, "1. Từ vựng", "10'"), stepEl(2, "2. Ngữ pháp", "5'")),
    inQuestion() ? h("div", { class: "wu-meta" }, h("span", { class: "wu-clock-wrap" }, icon("i-timer"), clock), progress, skip) : h("div", { class: "wu-meta" }));
  state.headerHost.replaceChildren(header);
  updateHeader();
}

function updateHeader() {
  const { clock, progress, skip } = state.refs;
  if (!progress || !progress.isConnected) return;
  const left = remainingMs(state.startedAt, Date.now(), state.limitMs);
  clock.textContent = formatClock(left);
  clock.dataset.low = String(left === 0);
  if (state.phase === "vocab") progress.textContent = `${state.results.vocab.length}/${state.deck.length}`;
  if (state.phase === "errors") progress.textContent = `${state.results.errors.length}/${state.queue.length}`;
  skip.disabled = state.answered;
}

function tick() {
  if (!state.active || !inQuestion()) return;
  const left = remainingMs(state.startedAt, Date.now(), state.limitMs);
  if (left === 0 && !state.timeUp) {
    state.timeUp = true;
    state.ui?.refreshNext?.(); // "Câu tiếp theo" becomes "Sang bước 2" / "Xem tổng kết"
  }
  updateHeader();
}

// ---- Showing a screen ----
function show(ui) {
  state.ui = ui;
  state.main.replaceChildren(ui.node);
  state.answered = false;
  updateHeader();
  window.scrollTo(0, 0);
  ui.focus?.();
}

const nextLabel = () => {
  const hasMore = state.phase === "vocab" ? state.idx + 1 < state.deck.length : state.eidx + 1 < state.queue.length;
  const action = afterQuestion({ step: state.phase === "vocab" ? 1 : 2, timeUp: state.timeUp, hasMore });
  return action === "next" ? "Câu tiếp theo" : action === "step2" ? "Sang bước 2" : "Xem tổng kết";
};

async function persistSession() {
  const warmup = sessionWarmup(summarizeSession(state.results.vocab, state.results.errors));
  const gradedAny = warmup.vocabTotal + warmup.errorsTotal > 0;
  if (!gradedAny) return;
  const rec = await saveSession(state.sessionId, state.today, warmup);
  state.sessionId = rec.id;
}

// ---- Step 1: vocabulary ----
function startVocab() {
  const { vocab, occurrences } = state.data;
  state.deck = pickDueCards(vocab, occurrences, state.today);
  state.idx = 0;
  state.phase = state.deck.length ? "vocab" : "vocab-empty";
  state.startedAt = Date.now();
  state.limitMs = limitFor(1);
  state.timeUp = false;
  buildHeader();
  if (!state.deck.length) {
    show(renderMessage({
      title: "Hôm nay chưa có từ nào đến hạn ôn",
      text: "Không có từ nào cần ôn lúc này. Chuyển sang bước 2: ngữ pháp.",
      buttonLabel: "Sang bước 2",
      onContinue: startErrors,
    }));
    return;
  }
  showVocabQuestion();
}

function showVocabQuestion() {
  const word = state.deck[state.idx];
  const kind = chooseKind(word, state.data.vocab);
  const q = buildQuestion(word, kind, state.data.vocab);
  const hooks = {
    nextLabel,
    next: () => advanceVocab(),
    async commit(outcome, { hintsUsed = 0 } = {}) {
      state.answered = true;
      updateHeader();
      const extra = q.kind === "type" ? { lastCollocation: q.collocation } : {};
      let message;
      try {
        const res = await reviewVocab(q.wordId, outcome, state.today, extra);
        message = outcomeMessage(outcome, res.fromBox, res.box);
      } catch (err) {
        showToast(err.message || "Không lưu được kết quả.", "error");
        message = outcomeMessage(outcome, q.box, q.box);
      }
      state.results.vocab.push({ id: q.wordId, outcome });
      await persistSession().catch(() => {});
      updateHeader();
      return { message };
    },
  };
  show(renderVocabQuestion(q, hooks));
}

function advanceVocab() {
  const hasMore = state.idx + 1 < state.deck.length;
  const action = afterQuestion({ step: 1, timeUp: state.timeUp, hasMore });
  if (action === "next") {
    state.idx++;
    showVocabQuestion();
  } else {
    startErrors();
  }
}

// ---- Step 2: grammar ----
function startErrors() {
  state.queue = pickErrorQueue(state.data.errors);
  state.eidx = 0;
  state.phase = state.queue.length ? "errors" : "errors-empty";
  state.startedAt = Date.now();
  state.limitMs = limitFor(2);
  state.timeUp = false;
  buildHeader();
  if (!state.queue.length) {
    show(renderMessage({
      title: "Chưa có lỗi nào để luyện",
      text: "Chưa có lỗi nào có câu đúng để luyện. Hãy thêm câu đúng cho các lỗi trong Grammar Notebook.",
      buttonLabel: "Xem tổng kết",
      onContinue: showSummary,
    }));
    return;
  }
  showErrorQuestion();
}

function showErrorQuestion() {
  const e = state.queue[state.eidx];
  const q = {
    errorId: e.id, original: e.original, corrected: e.corrected, typeLabel: errorTypeLabel(e.type),
    occurrences: e.occurrences ?? 1, explanationVi: e.explanationVi ?? "", correctExample: e.correctExample ?? "",
  };
  const hooks = {
    nextLabel,
    next: () => advanceErrors(),
    async commit(correct) {
      state.answered = true;
      updateHeader();
      try {
        const res = await reviewError(e.id, correct);
        state.errorStates.set(e.id, { ...res, id: e.id, explanationVi: q.explanationVi });
      } catch (err) {
        showToast(err.message || "Không lưu được kết quả.", "error");
      }
      state.results.errors.push({ id: e.id, correct });
      await persistSession().catch(() => {});
      updateHeader();
    },
  };
  show(renderErrorQuestion(q, hooks));
}

function advanceErrors() {
  const hasMore = state.eidx + 1 < state.queue.length;
  const action = afterQuestion({ step: 2, timeUp: state.timeUp, hasMore });
  if (action === "next") {
    state.eidx++;
    showErrorQuestion();
  } else {
    showSummary();
  }
}

// ---- Skip: leaves the card as it is (not graded, still due) ----
function onSkip() {
  if (state.answered) return;
  if (state.phase === "vocab") {
    state.results.vocab.push({ id: state.deck[state.idx].id, outcome: "skipped" });
    advanceVocab();
  } else if (state.phase === "errors") {
    state.results.errors.push({ id: state.queue[state.eidx].id, skipped: true });
    advanceErrors();
  }
}

// ---- Summary ----
async function showSummary() {
  state.phase = "summary";
  state.limitMs = 0;
  buildHeader();
  const summary = summarizeSession(state.results.vocab, state.results.errors);
  const wordById = new Map(state.data.vocab.map((w) => [w.id, w]));
  const wrongWords = summary.wrongVocabIds.map((id) => wordById.get(id)).filter(Boolean).map((w) => ({ word: w.word, meaningVi: w.meaningVi }));
  const errorById = new Map(state.data.errors.map((e) => [e.id, e]));
  const wrongErrors = summary.wrongErrorIds.map((id) => errorById.get(id)).filter(Boolean)
    .map((e) => ({ original: e.original, corrected: e.corrected, explanationVi: e.explanationVi }));
  const suggestions = [...state.errorStates.values()]
    .filter((e) => shouldSuggestFixed({ warmupStreak: e.warmupStreak, status: e.status }))
    .map((e) => ({ id: e.id, original: e.original, corrected: e.corrected, streak: e.warmupStreak }));
  let next = null;
  try {
    next = nextTest(await loadPracticeData());
  } catch { /* the button is optional */ }
  if (!state.active) return;
  show(renderSummary({ summary, wrongWords, wrongErrors, suggestions, next }, {
    async markFixed(id) {
      await markErrorsFixed([id], "fixed");
      showToast("Đã đánh dấu đã khắc phục.");
    },
  }));
}

// ---- Keys ----
function onKeydown(e) {
  if (!state.active || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing) return;
  const t = e.target;
  if (t instanceof Element && t.closest("input, textarea, select")) return; // typing: the field handles Enter itself
  if (state.ui?.onKey?.(e)) e.preventDefault();
}

export const warmupView = {
  mount(container) {
    freshState();
    state.active = true;
    state.container = container;
    const token = ++state.token;
    state.today = isoDate();

    state.headerHost = h("div", { class: "wu-header-host" });
    state.main = h("main", { class: "wu-main" }, h("p", { class: "muted" }, "Đang tải…"));
    container.replaceChildren(h("div", { class: "wu" }, state.headerHost, state.main));
    buildHeader();

    state.keyHandler = onKeydown;
    document.addEventListener("keydown", state.keyHandler);
    state.timer = setInterval(tick, 500);

    loadWarmupData().then((data) => {
      if (token !== state.token) return;
      state.data = data;
      startVocab();
    }).catch((err) => {
      if (token !== state.token) return;
      state.phase = "failed";
      state.main.replaceChildren(h("p", { class: "form-error" }, `Không đọc được dữ liệu: ${err.message}`));
    });
  },

  unmount() {
    state.active = false;
    state.token++;
    clearInterval(state.timer);
    if (state.keyHandler) document.removeEventListener("keydown", state.keyHandler);
  },
};
