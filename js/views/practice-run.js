// In-app practice screen (spec 5.9): #/practice/:book/:test/:skill, skill = L | R | W.
// Left: the exam (PDF / audio the learner picks). Right: the answer sheet (L/R) or the writing box (W).
// The app holds no exam text and no answer key: the learner marks each answer against their own book.
import { h, todayIso, formatDateVi } from "../components/dom.js";
import { showToast } from "../components/toast.js";
import { confirmModal } from "../components/modal.js";
import { openQuickCapture } from "../components/quick-capture.js";
import { openResultModal } from "./practice-forms.js";
import { createSource } from "./practice-run-source.js";
import { rawToBand, formatBand } from "../services/bands.js";
import { SKILL_NAMES, indexAttempts, testKey } from "../services/progress.js";
import { partLabel } from "../services/taxonomy.js";
import {
  loadPracticeData, findAttempt, saveAttempt, loadWritingDraft, saveWritingDraft, finishWriting,
} from "../services/practice-store.js";
import {
  partGroups, partOfQuestion, isSheetSkill, defaultMinutes, remainingSec, isTimeUp, clampLimit, formatClockSec, durationMinutes,
  countCorrect, countUnmarked, countBlank, TOTAL_QUESTIONS, draftKey, emptyDraft, loadDraft, saveDraft, clearDraft,
  pickWritingState, wordStatus, countWords, MIN_LIMIT, MAX_LIMIT,
} from "../services/practice-run.js";

const AUTOSAVE_MS = 5000;
const noStorage = { getItem: () => null, setItem() {}, removeItem() {} };
function storage() {
  try { return window.localStorage ?? noStorage; } catch { return noStorage; }
}

let s = null; // state of the screen that is mounted now (null when none)

const panelHref = (x) => `#/practice/${x.book}/${x.test}`;
const skillTitle = (x) => (x.skill === "W" ? `Writing Task ${x.task}` : SKILL_NAMES[x.skill]);

// ---- Persistence ----
function persistLocal() {
  if (!s || s.finished) return;
  if (s.skill === "W") {
    s.draft.text = s.sub.text;
    s.draft.prompt = s.sub.prompt;
  }
  saveDraft(storage(), s.key, s.draft);
}

// Writes are chained so two saves never race (which would create two records for one piece).
function persistWriting() {
  if (!s || s.skill !== "W" || s.finished) return Promise.resolve();
  const x = s;
  x.chain = x.chain.then(async () => {
    if (!x.sub.dirty) return;
    if (!x.sub.id && x.sub.text.trim() === "" && x.sub.prompt.trim() === "") return;
    x.sub.dirty = false;
    try {
      const rec = await saveWritingDraft({
        id: x.sub.id, book: x.book, test: x.test, task: x.task, prompt: x.sub.prompt, text: x.sub.text, durationSec: x.draft.elapsedSec,
      });
      x.sub.id = rec.id;
    } catch (err) {
      x.sub.dirty = true;
      showToast(`Chưa lưu được bài viết: ${err.message || "lỗi không rõ"}`, "error");
    }
  });
  return x.chain;
}

function flush() {
  if (!s || s.finished) return;
  tick();
  persistLocal();
  persistWriting();
}

// ---- Clock ----
function tick() {
  if (!s) return;
  const now = Date.now();
  const counting = s.running && s.draft.phase !== "grade" && !s.finished && !isTimeUp(s.draft.limitMin, s.draft.elapsedSec);
  if (counting) s.draft.elapsedSec += (now - s.last) / 1000;
  s.last = now;
  renderClock();
}

function renderClock() {
  const d = s.draft;
  const up = isTimeUp(d.limitMin, d.elapsedSec);
  const grading = d.phase === "grade";
  s.refs.time.textContent = grading ? formatClockSec(d.elapsedSec) : formatClockSec(remainingSec(d.limitMin, d.elapsedSec));
  s.refs.time.dataset.state = grading ? "done" : up ? "up" : s.running ? "run" : "pause";
  const fresh = d.elapsedSec === 0; // never started: the clock only runs after "Bắt đầu" (or the first Play of the audio)
  s.refs.timeLabel.textContent = grading ? "Đã dùng" : up ? "Hết giờ" : s.running ? "Còn lại" : fresh ? "Chưa bắt đầu" : "Đang tạm dừng";
  s.refs.pause.textContent = s.running ? "Tạm dừng" : fresh ? "Bắt đầu" : "Tiếp tục";
  s.refs.pause.hidden = grading || up || s.finished;
  s.refs.limit.hidden = grading || s.finished;
  s.refs.timeUp.hidden = !(up && !grading && !s.finished);
  if (up !== s.locked) setLocked(up);
}

function setLocked(locked) {
  s.locked = locked;
  s.root.dataset.locked = String(locked);
  for (const el of s.root.querySelectorAll(".ans, .write-text")) el.readOnly = locked || s.finished;
}

// The first Play of the audio starts a clock that has never been started. After a reload the clock stays paused:
// only "Tiếp tục" runs it again.
function startIfFresh() {
  if (!s || s.running || s.finished || s.draft.phase === "grade" || s.draft.elapsedSec !== 0) return;
  s.running = true;
  s.last = Date.now();
  renderClock();
}

// ---- Answer sheet (Listening / Reading) ----
const groupTitle = (g) => `${partLabel(s.skill, g.part)} · câu ${g.from}–${g.to}`;

function renderSheet() {
  const d = s.draft;
  const grading = d.phase === "grade";
  s.root.dataset.phase = d.phase;
  const groups = partGroups(s.skill).map((g) => {
    const rows = g.numbers.map((n) => (grading ? gradeRow(n) : answerRow(n)));
    return h("section", { class: "sheet-group", dataset: { part: String(g.part) } },
      h("h3", { class: "sheet-group-title" }, groupTitle(g)),
      h("ul", { class: "sheet-list" }, rows));
  });
  s.refs.sheet.replaceChildren(...groups);
  setLocked(s.locked);
  updateActions();
}

function answerRow(n) {
  const inputs = () => [...s.refs.sheet.querySelectorAll(".ans")];
  const input = h("input", {
    class: "input ans", type: "text", id: `ans-${n}`, value: s.draft.answers[n] ?? "", autocomplete: "off", autocapitalize: "off",
    autocorrect: "off", spellcheck: "false", enterkeyhint: "next", "aria-label": `Câu ${n}`, dataset: { n: String(n) },
    onInput: () => { s.draft.answers[n] = input.value; },
    onChange: () => persistLocal(),
    onKeydown: (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      const all = inputs();
      const next = all[all.indexOf(input) + 1];
      if (next) next.focus();
      else s.refs.action.focus();
    },
  });
  return h("li", { class: "sheet-row" }, h("label", { class: "sheet-num", for: `ans-${n}` }, String(n)), input);
}

function gradeRow(n) {
  const ans = (s.draft.answers[n] ?? "").trim();
  const mark = s.draft.marks[n];
  const btn = (value, label, key) => h("button", {
    type: "button", class: "btn btn-outline grade-btn", tabindex: "-1", dataset: { mark: value ? "right" : "wrong" },
    "aria-pressed": String(mark === value), title: `Phím ${key}`,
    onClick: () => setMark(n, mark === value ? null : value, false),
  }, label);
  return h("li", { class: "grade-row", tabindex: "0", dataset: { n: String(n) }, "aria-label": `Câu ${n}: ${ans || "chưa điền"}` },
    h("span", { class: "sheet-num" }, String(n)),
    h("span", { class: "grade-answer", title: ans }, ans || "—"),
    h("div", { class: "grade-btns" }, btn(true, "Đúng", 1), btn(false, "Sai", 2)),
    mark === false
      ? h("button", { type: "button", class: "btn btn-text btn-sm grade-capture", onClick: () => captureFor(n) }, "Ghi lỗi/từ")
      : null);
}

function setMark(n, value, moveFocus) {
  if (value === null) delete s.draft.marks[n];
  else s.draft.marks[n] = value;
  const old = s.refs.sheet.querySelector(`.grade-row[data-n="${n}"]`);
  const fresh = gradeRow(n);
  old.replaceWith(fresh);
  persistLocal();
  updateActions();
  if (moveFocus && value !== null) (fresh.nextElementSibling ?? fresh.closest(".sheet-group")?.nextElementSibling?.querySelector(".grade-row") ?? fresh).focus();
  else if (moveFocus) fresh.focus();
}

function captureFor(n) {
  openQuickCapture({ source: { book: s.book, test: s.test, skill: s.skill, part: partOfQuestion(s.skill, n) } });
}

// The header button and the line beside it follow the phase.
function updateActions() {
  const d = s.draft;
  const { action, info } = s.refs;
  if (s.skill === "W") {
    action.textContent = "Xong";
    info.textContent = "";
    return;
  }
  if (d.phase === "grade") {
    const right = countCorrect(d.marks);
    const left = countUnmarked(d.marks);
    action.textContent = "Lưu điểm";
    info.textContent = left > 0 ? `Đúng ${right}/${TOTAL_QUESTIONS} · Còn ${left} ô chưa chấm` : `Đúng ${right}/${TOTAL_QUESTIONS} · Đã chấm đủ`;
    info.dataset.warn = String(left > 0);
  } else {
    action.textContent = "Nộp bài";
    info.textContent = "";
  }
}

async function onAction() {
  if (!s || s.busy) return;
  if (s.skill === "W") return finishWrite();
  if (s.draft.phase !== "grade") return submitSheet();
  return saveScore();
}

async function submitSheet() {
  const blank = countBlank(s.draft.answers);
  if (blank > 0) {
    const ok = await confirmModal({
      title: "Nộp bài?", message: `Còn ${blank} câu chưa điền. Vẫn nộp bài và chuyển sang chấm?`, confirmLabel: "Nộp bài",
    });
    if (!ok || !s) return;
  }
  tick();
  s.draft.phase = "grade";
  persistLocal();
  renderClock();
  renderSheet();
  s.refs.sheet.querySelector(".grade-row")?.focus();
  s.root.dataset.tab = "sheet";
  syncTabs();
}

// Same rule as "Nhập kết quả": one attempt per test and skill, saving again overwrites it, so ask first.
async function saveScore() {
  s.busy = true;
  const x = s;
  try {
    const raw = countCorrect(x.draft.marks);
    const band = rawToBand(x.skill, raw);
    const old = await findAttempt(x.book, x.test, x.skill);
    if (old) {
      const was = `${old.rawScore != null ? `${old.rawScore}/40 · ` : ""}Band ${formatBand(old.band)}${old.date ? ` (${formatDateVi(old.date)})` : ""}`;
      const ok = await confirmModal({
        title: "Ghi đè điểm đã có?",
        message: `Cam ${x.book} Test ${x.test} đã có điểm ${SKILL_NAMES[x.skill]}: ${was}. Lưu kết quả mới (${raw}/40 · Band ${formatBand(band)}) sẽ ghi đè điểm cũ.`,
        confirmLabel: "Ghi đè", danger: true,
      });
      if (!ok || s !== x) return;
    }
    tick();
    await saveAttempt({
      book: x.book, test: x.test, skill: x.skill, rawScore: raw, band, date: todayIso(),
      durationMin: durationMinutes(x.draft.elapsedSec), note: old?.note ?? "",
    });
    x.finished = true;
    clearDraft(storage(), x.key); // only after the attempt is saved
    showToast(`Đã lưu ${SKILL_NAMES[x.skill]} · Cam ${x.book} Test ${x.test}: ${raw}/40 · Band ${formatBand(band)}`);
    location.hash = panelHref(x);
  } catch (err) {
    showToast(err.message || "Không lưu được điểm.", "error");
  } finally {
    if (s === x) s.busy = false;
  }
}

// ---- Writing ----
function renderWriting() {
  const w = s.sub;
  const taskBtns = [1, 2].map((t) => h("button", {
    type: "button", class: "seg-btn", dataset: { task: String(t) }, "aria-pressed": String(s.task === t), onClick: () => switchTask(t),
  }, `Task ${t}`));
  const promptBox = h("textarea", {
    class: "input write-prompt", id: "w-prompt", rows: "3", placeholder: "Dán hoặc gõ đề bài từ sách của bạn (chỉ lưu trên máy này)",
    onInput: () => { w.prompt = promptBox.value; w.dirty = true; persistLocal(); },
  }, w.prompt);
  const text = h("textarea", {
    class: "input write-text", id: "w-text", placeholder: "Viết bài của bạn ở đây", spellcheck: "false",
    onInput: () => { w.text = text.value; w.dirty = true; persistLocal(); renderCount(); },
  }, w.text);
  const count = h("p", { class: "write-count", "aria-live": "polite" });
  s.refs.count = count;
  s.refs.sheet.replaceChildren(h("div", { class: "write" },
    h("div", { class: "seg seg-small", role: "group", "aria-label": "Chọn Task" }, taskBtns),
    h("label", { class: "field-label", for: "w-prompt" }, "Đề bài"),
    promptBox,
    h("label", { class: "field-label", for: "w-text" }, "Bài viết"),
    text,
    count));
  renderCount();
  setLocked(s.locked);
  updateActions();
}

function renderCount() {
  const { words, min, short } = wordStatus(s.sub.text, s.task);
  s.refs.count.textContent = short > 0 ? `Số từ: ${words} · Cần ít nhất ${min} từ, còn thiếu ${short}` : `Số từ: ${words} · Đủ ${min} từ tối thiểu`;
  s.refs.count.dataset.warn = String(short > 0);
}

// Loads the clock and the unfinished piece of one Task into the screen.
async function loadTask(task) {
  s.task = task;
  s.key = draftKey(s.book, s.test, "W", task);
  const draft = loadDraft(storage(), s.key, "W", task) ?? emptyDraft("W", task);
  const sub = await loadWritingDraft(s.book, s.test, task);
  const picked = pickWritingState(draft, sub);
  s.draft = draft;
  s.running = false; // every Task's clock starts paused
  s.running = false;
  s.sub = { id: sub?.id ?? null, text: picked.text, prompt: picked.prompt, dirty: picked.text !== (sub?.text ?? "") || picked.prompt !== (sub?.prompt ?? "") };
  s.last = Date.now();
  s.refs.limit.querySelector("input").value = String(draft.limitMin);
}

async function switchTask(task) {
  if (task === s.task || s.busy) return;
  s.busy = true;
  const x = s;
  try {
    flush();
    await x.chain;
    if (s !== x) return;
    await loadTask(task);
    s.refs.title.textContent = `Cam ${s.book} · Test ${s.test} · ${skillTitle(s)}`;
    document.title = `Luyện Cam ${s.book} Test ${s.test} · ${skillTitle(s)} · English Learning Hub`;
    renderWriting();
    renderClock();
  } finally {
    if (s === x) s.busy = false;
  }
}

async function finishWrite() {
  const x = s;
  if (countWords(x.sub.text) === 0) {
    showToast("Bài viết đang trống.", "error");
    return;
  }
  x.busy = true;
  try {
    tick();
    await x.chain;
    const rec = await finishWriting({
      id: x.sub.id, book: x.book, test: x.test, task: x.task, prompt: x.sub.prompt, text: x.sub.text, durationSec: x.draft.elapsedSec,
    });
    x.sub.id = rec.id;
    x.finished = true;
    clearDraft(storage(), x.key);
    if (s !== x) return;
    x.running = false;
    renderClock();
    setLocked(true);
    showDone(rec.id);
  } catch (err) {
    showToast(err.message || "Không lưu được bài viết.", "error");
  } finally {
    if (s === x) s.busy = false;
  }
}

// The piece is saved. The band is typed by hand, with the same modal as "Nhập kết quả".
async function showDone(submissionId) {
  const x = s;
  s.refs.action.hidden = true;
  s.refs.done.hidden = false;
  const data = await loadPracticeData();
  if (s !== x) return;
  const entry = indexAttempts(data.attempts).get(testKey(x.book, x.test));
  showToast(`Đã lưu bài viết Task ${x.task}.`);
  openResultModal({
    book: x.book, test: x.test, skill: "W", task: x.task, entry, submissionId,
    suggestMinutes: durationMinutes(x.draft.elapsedSec),
    onSaved: () => { location.hash = panelHref(x); },
  });
}

// ---- Keyboard ----
function onKeydown(e) {
  if (!s || document.body.hasAttribute("data-overlay-open")) return;
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  const t = e.target instanceof Element ? e.target : document.body;

  if (!e.shiftKey && (e.key === "1" || e.key === "2") && s.skill !== "W" && s.draft.phase === "grade") {
    const row = t.closest(".grade-row");
    if (row) {
      e.preventDefault();
      setMark(Number(row.dataset.n), e.key === "1", true);
      return;
    }
  }
  if (t.closest('input, textarea, select, audio, [contenteditable]:not([contenteditable="false"])')) return;
  if (!s.source.hasAudio() || s.skill !== "L" || s.draft.phase === "grade") return;
  if (e.key === " " && !t.closest("button, a, summary")) {
    e.preventDefault();
    s.source.toggle();
  } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    s.source.seek(e.key === "ArrowLeft" ? -5 : 5);
  }
}

// ---- Layout ----
function syncTabs() {
  for (const b of s.refs.tabs.children) b.setAttribute("aria-selected", String(b.dataset.tab === s.root.dataset.tab));
}

function buildFrame(testRec) {
  const x = s;
  const time = h("span", { class: "run-time nowrap", role: "timer" }, "00:00");
  const timeLabel = h("span", { class: "run-time-label nowrap" }, "");
  const pause = h("button", {
    type: "button", class: "btn btn-outline", dataset: { role: "pause" },
    onClick: () => { tick(); x.running = !x.running; x.last = Date.now(); renderClock(); },
  }, "Tạm dừng");
  const limitInput = h("input", {
    class: "input run-limit-input", type: "number", inputmode: "numeric", min: String(MIN_LIMIT), max: String(MAX_LIMIT), step: "1",
    value: String(x.draft.limitMin), "aria-label": "Giới hạn thời gian (phút)",
    onChange: () => {
      tick();
      x.draft.limitMin = clampLimit(limitInput.value, x.draft.limitMin);
      limitInput.value = String(x.draft.limitMin);
      persistLocal();
      renderClock();
    },
  });
  const limit = h("label", { class: "run-limit" }, h("span", { class: "run-limit-text nowrap" }, "Giới hạn"), limitInput, h("span", { class: "nowrap" }, "phút"));
  const timeUp = h("p", { class: "run-timeup", role: "alert", hidden: true },
    x.skill === "W" ? "Hết giờ. Bài viết đã khóa, bấm Xong để lưu." : "Hết giờ. Phiếu đã khóa, bạn vẫn nộp bài và chấm được.");

  const action = h("button", { type: "button", class: "btn btn-primary run-action", dataset: { role: "action" }, onClick: onAction }, "Nộp bài");
  const done = h("a", { class: "btn btn-primary", href: panelHref(x), hidden: true }, "Về panel test");
  const info = h("span", { class: "run-info nowrap", "aria-live": "polite" });
  const title = h("h1", { class: "run-title" }, `Cam ${x.book} · Test ${x.test} · ${skillTitle(x)}`);

  const header = h("header", { class: "run-bar" },
    h("a", { class: "btn btn-text run-exit", href: panelHref(x), onClick: () => flush() }, "← Thoát"),
    title,
    h("div", { class: "run-clock" }, h("div", { class: "run-time-box" }, time, timeLabel), pause, limit),
    h("div", { class: "run-submit" }, info, action, done),
    timeUp);

  x.source = createSource({ book: x.book, test: x.test, skill: x.skill, testRec, storage: storage(), onPlay: startIfFresh });
  const sheet = h("div", { class: "run-sheet-body" });
  const tabs = h("div", { class: "seg run-tabs", role: "tablist", "aria-label": "Đề hoặc phiếu" },
    [["source", "Đề"], ["sheet", x.skill === "W" ? "Bài viết" : "Phiếu"]].map(([id, label]) => h("button", {
      type: "button", class: "seg-btn", role: "tab", dataset: { tab: id },
      onClick: () => { x.root.dataset.tab = id; syncTabs(); },
    }, label)));

  x.root = h("div", { class: "run", dataset: { skill: x.skill, phase: x.draft.phase, tab: "source", locked: "false" } },
    header, tabs, x.source.audioBar,
    h("div", { class: "run-body" },
      h("section", { class: "run-pane run-source", "aria-label": "Đề" }, x.source.pane),
      h("section", { class: "run-pane run-sheet", "aria-label": x.skill === "W" ? "Bài viết" : "Phiếu trả lời" }, sheet)));
  x.refs = { time, timeLabel, pause, limit, timeUp, action, done, info, sheet, tabs, title };
  x.refs.limit = limit;
  return x.root;
}

// ---- Mount / unmount ----
async function start(container, params) {
  const book = Number(params.book);
  const test = Number(params.test);
  const skill = params.skill;
  const x = {
    container, book, test, skill, task: skill === "W" ? 2 : null, finished: false, busy: false, running: false, locked: false,
    last: Date.now(), chain: Promise.resolve(), timers: [], listeners: [], source: null, refs: null, root: null,
    key: draftKey(book, test, skill, skill === "W" ? 2 : null), draft: null, sub: null,
  };
  s = x;
  container.replaceChildren(h("p", { class: "muted run-loading" }, "Đang tải…"));
  let testRec = null;
  try {
    const data = await loadPracticeData();
    testRec = data.tests.find((t) => t.key === testKey(book, test)) ?? null;
    if (s !== x) return;
    if (isSheetSkill(skill)) {
      x.draft = loadDraft(storage(), x.key, skill) ?? emptyDraft(skill);
    } else {
      x.draft = emptyDraft("W", 2); // replaced by loadTask() once the frame exists
    }
  } catch (err) {
    if (s === x) container.replaceChildren(h("p", { class: "form-error" }, `Không đọc được dữ liệu: ${err.message}`));
    return;
  }

  container.replaceChildren(buildFrame(testRec));
  if (skill === "W") {
    try {
      await loadTask(2);
    } catch (err) {
      showToast(`Không đọc được bài nháp: ${err.message}`, "error");
      x.sub = { id: null, text: "", prompt: "", dirty: false };
    }
    if (s !== x) return;
    renderWriting();
  } else {
    renderSheet();
  }
  syncTabs();
  x.last = Date.now();
  renderClock();

  x.timers.push(setInterval(tick, 500), setInterval(flush, AUTOSAVE_MS));
  const on = (target, type, fn) => { target.addEventListener(type, fn); x.listeners.push([target, type, fn]); };
  on(document, "keydown", onKeydown);
  on(window, "pagehide", flush);
  on(document, "visibilitychange", () => { if (document.hidden) flush(); });
}

function stop() {
  if (!s) return;
  const x = s;
  flush();
  s = null; // stops late async work from touching a screen that is gone
  for (const t of x.timers) clearInterval(t);
  for (const [target, type, fn] of x.listeners) target.removeEventListener(type, fn);
  x.source?.destroy();
}

export const practiceRunView = {
  mount(container, params) {
    stop();
    start(container, params);
  },
  update(params) {
    const container = s?.container ?? document.getElementById("view");
    stop();
    start(container, params);
  },
  unmount: stop,
};
