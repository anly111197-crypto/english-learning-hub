// Writing & Speaking analysis (step 8b): what the learner sees of Claude's answer. Pure: no IndexedDB, no DOM.
import { CRITERIA } from "../ai/schema.js";
import { roundBand } from "./bands.js";
import { normalizeText, lemmaPosKey, findErrorDuplicate } from "./dedupe.js";
import { sourceLabel } from "./taxonomy.js";

const isLive = (r) => r && !r.deleted;

// ---- Band: the app recomputes overall from the four criteria ----

// Average of the four criteria rounded to the nearest 0.5 (rule 6.1: 6.25 -> 6.5, 6.75 -> 7.0).
export function overallFromCriteria(task, bands) {
  const values = CRITERIA[task].map((k) => bands[k]);
  return roundBand(values.reduce((a, b) => a + b, 0) / values.length);
}

// { claude, computed, differs }: the band written into the matrix is always `computed`.
export function overallInfo(result) {
  const computed = overallFromCriteria(result.task, result.bands);
  return { claude: result.bands.overall, computed, differs: result.bands.overall !== computed };
}

// The record stored in submissions.bands: overall (computed) and c1..c4 in the order of the task's criteria.
export function bandsRecord(result) {
  const { claude, computed } = overallInfo(result);
  const [c1, c2, c3, c4] = CRITERIA[result.task].map((k) => result.bands[k]);
  return { overall: computed, c1, c2, c3, c4, claudeOverall: claude };
}

// ---- Highlight: find each wrong phrase in the learner's text ----

const isWordChar = (ch) => ch !== undefined && ch !== "" && /[\p{L}\p{N}]/u.test(ch);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function boundaryOk(text, start, end) {
  if (isWordChar(text[start]) && isWordChar(text[start - 1])) return false;
  if (isWordChar(text[end - 1]) && isWordChar(text[end])) return false;
  return true;
}

// Every place where `needle` occurs as whole words. Exact first; only when that finds nothing, ignore case and
// let any run of white space match (Claude may have changed a line break or a capital letter).
function findAll(text, needle) {
  const out = [];
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
    if (boundaryOk(text, i, i + needle.length)) out.push({ start: i, end: i + needle.length });
  }
  if (out.length) return out;
  const words = needle.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return out;
  const re = new RegExp(words.map(escapeRegex).join("\\s+"), "giu");
  for (const m of text.matchAll(re)) {
    if (boundaryOk(text, m.index, m.index + m[0].length)) out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// errors: result.errors ({ original, start, end }). Returns
//   segments: [{ text, errorIndex }]  (errorIndex null for plain text), covering the whole text in order
//   located:  indexes of the errors that have at least one mark
//   missing:  indexes of the errors that were not found anywhere
// Every place where an error's `original` is found is marked (the same mistake may occur more than once even though
// Claude lists a signature at most twice). start/end are only a hint: when text.slice(start, end) is the original it is
// marked even where the word-boundary rule would reject it; when they are off, the search by `original` is used.
// Overlaps: the earlier mark wins, then the longer one.
export function locateErrors(text, errors) {
  const source = String(text ?? "");
  const candidates = [];
  errors.forEach((err, index) => {
    const original = String(err.original ?? "");
    if (!original.trim()) return;
    const found = findAll(source, original);
    if (Number.isInteger(err.start) && Number.isInteger(err.end) && source.slice(err.start, err.end) === original
      && !found.some((f) => f.start === err.start)) {
      found.push({ start: err.start, end: err.end });
    }
    for (const f of found) candidates.push({ ...f, errorIndex: index });
  });
  candidates.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start) || a.errorIndex - b.errorIndex);
  const picked = [];
  let edge = 0;
  for (const c of candidates) {
    if (c.start < edge) continue;
    picked.push(c);
    edge = c.end;
  }
  const segments = [];
  let at = 0;
  for (const p of picked) {
    if (p.start > at) segments.push({ text: source.slice(at, p.start), errorIndex: null });
    segments.push({ text: source.slice(p.start, p.end), errorIndex: p.errorIndex });
    at = p.end;
  }
  if (at < source.length) segments.push({ text: source.slice(at), errorIndex: null });
  const located = [...new Set(picked.map((p) => p.errorIndex))].sort((a, b) => a - b);
  const missing = errors.map((_, i) => i).filter((i) => !located.includes(i));
  return { segments, located, missing };
}

// ---- The two trays ----

export const errorKey = (e) => `${normalizeText(e.signature)}|${normalizeText(e.original)}`;
export const vocabKey = (v) => lemmaPosKey(v.lemma, v.pos);

// The saved card that this error would fold into: same signature first, then the very same wrong sentence.
export function findExistingError(errors, item) {
  const live = errors.filter(isLive);
  const sig = normalizeText(item.signature);
  return live.find((e) => normalizeText(e.signature) === sig) ?? findErrorDuplicate(live, item.original);
}

// The saved word card: same lemma + pos, or a card the learner captured with only the word (empty pos, same lemma).
export function findExistingVocab(vocab, lemma, pos) {
  const live = vocab.filter(isLive);
  const key = lemmaPosKey(lemma, pos);
  return live.find((v) => lemmaPosKey(v.lemma ?? v.word, v.pos) === key)
    ?? live.find((v) => normalizeText(v.lemma ?? v.word) === normalizeText(lemma) && normalizeText(v.pos) === "");
}

// The tray rows. ctx = { errors, vocab, occurrences, saved: { errors: [keys], vocab: [keys] } } (all stored data).
// "Mới" or "Đã có · lần N" (N = how many times it is already recorded); mistakes of low severity start unticked;
// items already saved from this piece are marked saved and cannot be saved twice.
export function buildTray(result, { errors = [], vocab = [], occurrences = [], saved = {} } = {}) {
  const savedErrors = new Set(saved.errors ?? []);
  const savedVocab = new Set(saved.vocab ?? []);
  const vocabSeen = new Map();
  for (const o of occurrences) if (o.itemType === "vocab" && !o.deleted) vocabSeen.set(o.itemId, (vocabSeen.get(o.itemId) ?? 0) + 1);

  const seenErrors = new Set();
  const errorRows = [];
  result.errors.forEach((item, index) => {
    const key = errorKey(item);
    if (seenErrors.has(key)) return; // the same wrong phrase twice in one answer
    seenErrors.add(key);
    const existing = findExistingError(errors, item) ?? null;
    const isSaved = savedErrors.has(key);
    errorRows.push({
      kind: "error", index, key, item, existing, saved: isSaved,
      label: isSaved ? "Đã lưu" : existing ? `Đã có · lần ${Math.max(1, Number(existing.occurrences) || 1)}` : "Mới",
      checked: !isSaved && item.severity !== "low",
    });
  });

  const seenVocab = new Set();
  const vocabRows = [];
  result.vocabularySuggestions.forEach((item, index) => {
    const key = vocabKey(item);
    if (seenVocab.has(key)) return;
    seenVocab.add(key);
    const existing = findExistingVocab(vocab, item.lemma, item.pos) ?? null;
    const isSaved = savedVocab.has(key);
    vocabRows.push({
      kind: "vocab", index, key, item, existing, saved: isSaved,
      label: isSaved ? "Đã lưu" : existing ? `Đã có · lần ${Math.max(1, vocabSeen.get(existing.id) ?? 0)}` : "Mới",
      checked: !isSaved,
    });
  });
  return { errors: errorRows, vocab: vocabRows };
}

// ---- The picker of earlier pieces ----

const KIND_OF_MODE = { writing: "writing", speaking: "speaking" };

// Pieces worth listing: finished on the practice screen (doneAt), analysed, or typed on this screen.
export function pickerSubmissions(submissions, mode) {
  return submissions
    .filter((s) => isLive(s) && s.kind === KIND_OF_MODE[mode] && String(s.text ?? "").trim() !== "" && (s.doneAt || s.status === "analyzed" || s.origin === "studio"))
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")) || String(a.id).localeCompare(String(b.id)));
}

export function submissionLabel(sub) {
  const src = sub.source ?? {};
  const where = src.book
    ? sourceLabel({ book: src.book, test: src.test }) + (sub.kind === "writing" ? ` · Task ${src.task ?? 2}` : src.part ? ` · Part ${src.part}` : "")
    : sub.kind === "writing" ? `Task ${src.task ?? 2}` : src.part ? `Part ${src.part}` : "Không gắn test";
  const state = sub.status === "analyzed" ? "Đã phân tích" : sub.doneAt ? "Đã viết" : "Nháp";
  const words = Number(sub.wordCount) || 0;
  return `${where} · ${words} từ · ${state}`;
}

// The Claude task that matches the screen's choice.
export const taskFor = (mode, writingTask) => (mode === "speaking" ? "speaking" : writingTask === 1 ? "writing_task1" : "writing_task2");
