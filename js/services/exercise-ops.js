// Database side of the exercises from mistakes (step 8c). Views call this, not repo.js directly.
// The exercise is stored as soon as Claude's answer has been read, and every answer is stored at once, so closing the page
// half way loses nothing and the same exercise can be continued.
import { list, get, put, query } from "./repo.js";
import { setStatus } from "./error-ops.js";
import { perErrorScores, scoreOf, priorityAfter, fixedSuggestions, isExerciseComplete } from "./exercise.js";

export async function loadExerciseData() {
  const [exercises, errors] = await Promise.all([list("exercises"), list("errors")]);
  return { exercises, errors };
}

export async function loadExercise(id) {
  return (await get("exercises", id)) ?? null;
}

// items: validated questions from parseExerciseResult. Every question starts without an answer.
export async function createExercise(items) {
  const errorIds = [...new Set(items.map((it) => it.errorId))];
  return put("exercises", {
    errorIds,
    items: items.map((it) => ({ ...it, userAnswer: null, correct: null, selfGraded: false })),
    score: null, doneAt: null, aiMode: "manual",
  });
}

// patch: { userAnswer, correct, selfGraded } for one question. Re-reads the stored exercise first.
export async function saveItem(exerciseId, index, patch) {
  const ex = await get("exercises", exerciseId);
  if (!ex || !ex.items[index]) throw new Error("Bài tập này không còn trong máy.");
  const items = ex.items.map((it, i) => (i === index ? { ...it, ...patch } : it));
  return put("exercises", { ...ex, items });
}

// All questions are marked: store the score and the time, and give the mistakes that were got wrong a priority in the
// 15-minute warm-up (spec 6.4). Done once: a finished exercise is only read.
// Returns { exercise, perError, suggestFixed: [errorId] }.
export async function finishExercise(exerciseId) {
  const ex = await get("exercises", exerciseId);
  if (!ex) throw new Error("Bài tập này không còn trong máy.");
  if (!isExerciseComplete(ex)) throw new Error("Bài tập chưa làm xong.");
  const perError = perErrorScores(ex);
  let saved = ex;
  if (!ex.doneAt) {
    saved = await put("exercises", { ...ex, score: scoreOf(ex), doneAt: new Date().toISOString() });
    for (const p of priorityAfter(perError)) {
      const err = await get("errors", p.errorId);
      if (err && (err.warmupPriority ?? 0) !== p.warmupPriority) await put("errors", { ...err, warmupPriority: p.warmupPriority });
    }
  }
  const errors = await list("errors");
  return { exercise: saved, perError, suggestFixed: fixedSuggestions(perError, errors) };
}

// The learner confirms: the mistakes are fixed. Their warm-up priority goes back to 0.
export async function markFixedAfterExercise(errorIds) {
  const n = await setStatus(errorIds, "fixed");
  for (const id of errorIds) {
    const err = await get("errors", id);
    if (err && err.warmupPriority) await put("errors", { ...err, warmupPriority: 0 });
  }
  return n;
}

export const exercisesOfError = (errorId) => query("exercises", "errorIds", errorId);