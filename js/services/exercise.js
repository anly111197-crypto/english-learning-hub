// Exercises from mistakes (step 8c, spec 5.8): choosing the mistakes, marking the answers on this device, the score of each
// mistake, what to suggest afterwards. Pure: no IndexedDB, no DOM.
import { ITEMS_PER_ERROR, MAX_EXERCISE_ERRORS } from "../ai/schema.js";
import { pickWarmupErrors } from "./errors.js";
import { diffWords } from "./diff.js";
import { errorTypeLabel } from "./taxonomy.js";

const isLive = (r) => r && !r.deleted;
const CELLS = 1500000;

// ---- Which mistakes can be practised ----

// Finished by Claude (so the rule and the correct sentence are known): enriched, a real signature, a correct sentence.
export function isExerciseReady(error) {
  return isLive(error) && Boolean(error.enriched)
    && String(error.signature ?? "").trim() !== "" && !String(error.signature).startsWith("pending:")
    && String(error.corrected ?? "").trim() !== "";
}

// selected: error records. Returns "" when 1-5 ready mistakes are chosen, else the message to show.
export function validateSelection(selected) {
  if (selected.length === 0) return "Chọn ít nhất một lỗi.";
  if (selected.length > MAX_EXERCISE_ERRORS) return `Mỗi bài tập chỉ có tối đa ${MAX_EXERCISE_ERRORS} lỗi (đang chọn ${selected.length}).`;
  const notReady = selected.filter((e) => !isExerciseReady(e));
  if (notReady.length) {
    const names = notReady.slice(0, 3).map((e) => `"${String(e.original).slice(0, 40)}"`).join(", ");
    return `${notReady.length} lỗi chưa hoàn thiện với Claude (${names}${notReady.length > 3 ? "…" : ""}). Hãy hoàn thiện trước rồi tạo bài tập.`;
  }
  return "";
}

// With nothing selected: the 5 mistakes the warm-up would pick (rule 6.4: not fixed, priority, most repeated, latest),
// among those that can be practised.
export function pickExerciseErrors(errors, n = MAX_EXERCISE_ERRORS) {
  return pickWarmupErrors(errors.filter(isExerciseReady), n);
}

// What is sent to Claude about each mistake (spec 7.3): only what the learner wrote and the rule.
export function exercisePromptErrors(errors) {
  return errors.map((e) => ({
    errorId: e.id, label: e.original, original: e.original, corrected: e.corrected, type: e.type, signature: e.signature,
    ruleVi: e.explanationVi, correctExample: e.correctExample,
  }));
}

// ---- Marking an answer ----

// Case, extra spaces, the two kinds of apostrophe and quote, dashes, and the punctuation at the end do not matter.
export function normalizeAnswer(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[\s.!?;:,…]+$/u, "")
    .trim();
}

const acceptedFull = (item) => [item.answer, ...(item.acceptedAnswers ?? [])].map(normalizeAnswer).filter(Boolean);

// The words of `answer` that differ from the wrong sentence: from the first changed word to the last one (the words in
// between are kept). "" when nothing in the answer changed (a pure deletion has no part to type).
export function changedSpan(wrongSentence, answer) {
  const { right } = diffWords(wrongSentence, answer, { maxCells: CELLS });
  const first = right.findIndex((t) => t.changed);
  if (first === -1) return "";
  let last = first;
  right.forEach((t, i) => { if (t.changed) last = i; });
  return right.slice(first, last + 1).map((t) => t.text).join(" ");
}

// Result of marking: { correct: true | false | null, matched: "answer" | "span" | null, selfGrade: "override" | "choice" | null }
//   correct null  = a rewrite that does not match: the learner decides ("choice": Đúng ý / Sai)
//   selfGrade "override" = marked wrong, but "Tôi đúng ý" can turn it into right (fill, correct): Claude's acceptedAnswers
//                          may miss a correct variant
// choose is marked by the option picked and cannot be overridden.
export function gradeItem(item, userAnswer) {
  const user = normalizeAnswer(userAnswer);
  if (!user) return { correct: false, matched: null, selfGrade: null };
  if (item.kind === "choose") return { correct: acceptedFull(item).includes(user), matched: acceptedFull(item).includes(user) ? "answer" : null, selfGrade: null };
  if (acceptedFull(item).includes(user)) return { correct: true, matched: "answer", selfGrade: null };
  if (item.kind === "correct") {
    // the learner may type only the part they corrected: it counts when it is the changed part of the answer
    for (const full of [item.answer, ...(item.acceptedAnswers ?? [])]) {
      const span = normalizeAnswer(changedSpan(item.question, full));
      if (span && span === user) return { correct: true, matched: "span", selfGrade: null };
    }
    return { correct: false, matched: null, selfGrade: "override" };
  }
  if (item.kind === "rewrite") return { correct: null, matched: null, selfGrade: "choice" };
  return { correct: false, matched: null, selfGrade: "override" };
}

// ok: for "choice" the learner's pick (true = Đúng ý, false = Sai); for "override" always right ("Tôi đúng ý").
export function applySelfGrade(item, ok) {
  return { ...item, correct: Boolean(ok), selfGraded: true };
}

// ---- Progress and score ----

// An item is finished when it has an answer and a mark (a rewrite waits for the learner's own mark).
export const isItemDone = (item) => item.userAnswer !== null && item.userAnswer !== undefined && item.correct !== null && item.correct !== undefined;
export const isExerciseComplete = (exercise) => exercise.items.every(isItemDone);

// Index of the item to show: the first that has no answer yet, or whose own mark is still waiting; -1 when all are done.
export function nextItemIndex(exercise) {
  return exercise.items.findIndex((it) => !isItemDone(it));
}

export const scoreOf = (exercise) => exercise.items.filter((it) => it.correct === true).length;

// [{ errorId, correct, total }] in the order the mistakes first appear.
export function perErrorScores(exercise) {
  const order = [];
  const by = new Map();
  for (const it of exercise.items) {
    if (!by.has(it.errorId)) { by.set(it.errorId, { errorId: it.errorId, correct: 0, total: 0 }); order.push(it.errorId); }
    const s = by.get(it.errorId);
    s.total += 1;
    if (it.correct === true) s.correct += 1;
  }
  return order.map((id) => by.get(id));
}

// Mistakes that were right in all 3 questions and are not fixed yet: suggest "Đánh dấu đã khắc phục" (the learner decides).
export function fixedSuggestions(perError, errors) {
  const byId = new Map(errors.filter(isLive).map((e) => [e.id, e]));
  return perError
    .filter((s) => s.total >= ITEMS_PER_ERROR && s.correct === s.total && byId.get(s.errorId) && byId.get(s.errorId).status !== "fixed")
    .map((s) => s.errorId);
}

// The warm-up priority of each mistake after an exercise: as many as the questions it got wrong (0 when all right).
// Returns [{ errorId, warmupPriority }].
export function priorityAfter(perError) {
  return perError.map((s) => ({ errorId: s.errorId, warmupPriority: Math.max(0, s.total - s.correct) }));
}

// "Đã luyện N lần · lần cuối X/3": from the finished exercises that contain the mistake.
export function practiceStats(errorId, exercises) {
  const finished = exercises
    .filter((ex) => isLive(ex) && ex.doneAt && ex.items?.some((it) => it.errorId === errorId))
    .sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)) || String(b.id).localeCompare(String(a.id)));
  if (!finished.length) return null;
  const mine = finished[0].items.filter((it) => it.errorId === errorId);
  return { count: finished.length, correct: mine.filter((it) => it.correct === true).length, total: mine.length };
}

export const practiceLabel = (stats) => (stats ? `Đã luyện ${stats.count} lần · lần cuối ${stats.correct}/${stats.total}` : "");

export const unfinishedExercises = (exercises) => exercises
  .filter((ex) => isLive(ex) && !ex.doneAt)
  .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)));

export const recentExercises = (exercises, n = 5) => exercises
  .filter((ex) => isLive(ex) && ex.doneAt)
  .sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)) || String(b.id).localeCompare(String(a.id)))
  .slice(0, n);

export const KIND_LABELS = { fill: "Điền vào chỗ trống", correct: "Tìm và sửa lỗi trong câu", choose: "Chọn đáp án đúng", rewrite: "Viết lại câu" };

// One line for a mistake in lists: "He go… (Subject-Verb Agreement)".
export const errorLabel = (e) => `${String(e.original).slice(0, 60)} (${errorTypeLabel(e.type)})`;
