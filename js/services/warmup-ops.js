// Reads and writes for the warm-up. Every answer is written at once, so leaving half way loses nothing.
import { list, get, put } from "./repo.js";
import { applyOutcome, isoDate, isDue } from "./leitner.js";
import { applyErrorResult, pickErrorQueue } from "./warmup.js";
export { setStatus as markErrorsFixed } from "./error-ops.js";

export async function loadWarmupData() {
  const [vocab, occurrences, errors] = await Promise.all([list("vocab"), list("occurrences"), list("errors")]);
  return { vocab, occurrences, errors };
}

// "Đến hạn: N từ · M lỗi" (M = errors the warm-up would use, at most 5).
export async function loadDueCounts() {
  const { vocab, errors } = await loadWarmupData();
  const today = isoDate();
  return { words: vocab.filter((w) => isDue(w, today)).length, errors: pickErrorQueue(errors).length };
}

// Applies the answer to the card as it is stored now (not as it was when the session started).
// extra: more fields to store, e.g. { lastCollocation } so the same collocation is not asked twice in a row.
export async function reviewVocab(id, outcome, today = isoDate(), extra = {}) {
  const current = await get("vocab", id);
  if (!current) throw new Error("Từ này không còn trong kho.");
  const fields = applyOutcome(current, outcome, today);
  await put("vocab", { ...current, ...fields, ...extra });
  return { fromBox: current.box ?? 1, ...fields };
}

export async function reviewError(id, correct) {
  const current = await get("errors", id);
  if (!current) throw new Error("Lỗi này không còn trong sổ.");
  const fields = applyErrorResult(current, correct);
  await put("errors", { ...current, ...fields });
  return { ...fields, original: current.original, corrected: current.corrected };
}

// One `sessions` record per warm-up: created at the first graded answer, updated after every later one.
export async function saveSession(sessionId, date, warmup) {
  const existing = sessionId ? await get("sessions", sessionId, { includeDeleted: true }) : null;
  return put("sessions", { ...(existing ?? {}), ...(sessionId ? { id: sessionId } : {}), date: existing?.date ?? date, warmup, attemptIds: existing?.attemptIds ?? [] });
}
