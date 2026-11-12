// Session rules of the warm-up that are not about a single card: the clock, the grammar step, the summary.
// Pure functions (spec 5.5, 6.4).
import { pickWarmupErrors } from "./errors.js";

export const STEP_LIMITS_MS = { 1: 10 * 60 * 1000, 2: 5 * 60 * 1000 };
export const FIXED_STREAK = 3; // this many correct warm-ups in a row suggest "fixed"
export const ERRORS_PER_SESSION = 5;

// ---- Clock ----
export const remainingMs = (startedAt, now, limitMs) => Math.max(0, limitMs - (now - startedAt));

export function formatClock(ms) {
  const total = Math.ceil(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// What the "next" button does after a question is finished. When time is up the current question is finished
// first and then the session moves on.  Returns "next" | "step2" | "summary".
export function afterQuestion({ step, timeUp, hasMore }) {
  if (hasMore && !timeUp) return "next";
  return step === 1 ? "step2" : "summary";
}

// ---- Grammar step ----

// Up to 5 errors that are not fixed and already have a correct sentence.
export const pickErrorQueue = (errors, n = ERRORS_PER_SESSION) => pickWarmupErrors(errors, n, { requireCorrection: true });

// Fields after a self-graded error: right -> streak + 1 and new -> practicing; wrong -> streak 0.
export function applyErrorResult(error, correct) {
  const streak = correct ? (error.warmupStreak ?? 0) + 1 : 0;
  const status = correct && error.status === "new" ? "practicing" : error.status;
  return { warmupStreak: streak, status };
}

export const shouldSuggestFixed = (error) => (error.warmupStreak ?? 0) >= FIXED_STREAK && error.status !== "fixed";

// ---- Summary ----

// vocab results: { id, outcome: "correct" | "near" | "wrong" | "skipped" }; error results: { id, correct, skipped? }.
export function summarizeSession(vocabResults, errorResults) {
  const graded = vocabResults.filter((r) => r.outcome !== "skipped");
  const gradedErrors = errorResults.filter((r) => !r.skipped);
  return {
    vocabTotal: graded.length,
    vocabCorrect: graded.filter((r) => r.outcome === "correct").length,
    vocabNear: graded.filter((r) => r.outcome === "near").length,
    vocabSkipped: vocabResults.length - graded.length,
    wrongVocabIds: graded.filter((r) => r.outcome === "wrong").map((r) => r.id),
    errorsTotal: gradedErrors.length,
    errorsCorrect: gradedErrors.filter((r) => r.correct).length,
    errorsSkipped: errorResults.length - gradedErrors.length,
    wrongErrorIds: gradedErrors.filter((r) => !r.correct).map((r) => r.id),
  };
}

// The part of the summary that is stored in the `sessions` store (spec 7.1).
export const sessionWarmup = (s) => ({
  vocabTotal: s.vocabTotal,
  vocabCorrect: s.vocabCorrect,
  errorsTotal: s.errorsTotal,
  errorsCorrect: s.errorsCorrect,
  wrongVocabIds: s.wrongVocabIds,
});
