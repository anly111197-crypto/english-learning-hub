// Leitner boxes and the vocabulary part of the 15-minute warm-up (spec 5.5, 6.3). Pure functions.
import { normalizeText } from "./dedupe.js";

// ---- Boxes and dates ----
export const BOX_INTERVAL_DAYS = { 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 };
export const MAX_DECK = 20;
export const RECENT_CAPTURE_DAYS = 3;
export const NEAR_MIN_LENGTH = 6; // a one-character slip is "near" only for answers of at least 6 letters

const pad = (n) => String(n).padStart(2, "0");

// Local date as yyyy-mm-dd.
export const isoDate = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(new Date(y, m - 1, d + days)); // local calendar maths, so no DST surprises
}

export function nextReviewDate(box, fromIso = isoDate()) {
  const days = BOX_INTERVAL_DAYS[box];
  if (!days) throw new RangeError(`Hộp Leitner phải từ 1 đến 5, không phải ${box}.`);
  return addDays(fromIso, days);
}

// A card is due when its nextReview is today or earlier.
export const isDue = (card, todayIso = isoDate()) => Boolean(card?.nextReview) && card.nextReview <= todayIso;

// ---- Which cards ----

// The 3 most recent days on which the learner wrote down a word (days with a vocab occurrence, not calendar days).
export function recentCaptureDates(occurrences, n = RECENT_CAPTURE_DAYS) {
  const days = new Set(occurrences.filter((o) => !o.deleted && o.itemType === "vocab" && o.date).map((o) => o.date));
  return new Set([...days].sort().reverse().slice(0, n));
}

// Due cards for the warm-up, at most `limit`: (1) words written down in the last 3 capture days, (2) more lapses,
// (3) overdue the longest; then by id so the order is stable.
export function pickDueCards(vocab, occurrences, today, limit = MAX_DECK) {
  const recentDays = recentCaptureDates(occurrences);
  const recentIds = new Set(occurrences.filter((o) => !o.deleted && o.itemType === "vocab" && recentDays.has(o.date)).map((o) => o.itemId));
  return vocab
    .filter((w) => !w.deleted && isDue(w, today))
    .sort((a, b) =>
      (recentIds.has(b.id) ? 1 : 0) - (recentIds.has(a.id) ? 1 : 0)
      || (b.lapses ?? 0) - (a.lapses ?? 0)
      || String(a.nextReview).localeCompare(String(b.nextReview))
      || String(a.id).localeCompare(String(b.id)))
    .slice(0, limit);
}

// ---- Answer matching ----

export function levenshtein(a, b) {
  const s = [...a];
  const t = [...b];
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const row = [i];
    for (let j = 1; j <= t.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[t.length];
}

// "correct" (same text, ignoring case and extra spaces), "near" (one character off and the answer has at least
// 6 letters) or "wrong". `accepted` is a list of acceptable answers.
export function matchGrade(input, accepted) {
  const typed = normalizeText(input);
  if (!typed) return "wrong";
  const answers = accepted.map(normalizeText).filter(Boolean);
  if (answers.includes(typed)) return "correct";
  if (answers.some((a) => a.length >= NEAR_MIN_LENGTH && levenshtein(typed, a) === 1)) return "near";
  return "wrong";
}

// Common inflections of a single word ("mitigate" -> mitigates, mitigated, mitigating ...). A phrase stays as it is.
export function wordForms(word) {
  const w = normalizeText(word);
  if (!w) return [];
  if (/\s/.test(w)) return [w];
  const forms = new Set([w, `${w}s`, `${w}es`]);
  if (w.endsWith("e")) {
    forms.add(`${w}d`);
    forms.add(`${w.slice(0, -1)}ing`);
  } else {
    forms.add(`${w}ed`);
    forms.add(`${w}ing`);
  }
  if (/[^aeiou]y$/.test(w)) {
    forms.add(`${w.slice(0, -1)}ies`);
    forms.add(`${w.slice(0, -1)}ied`);
  }
  if (/[^aeiou][aeiou][^aeiouwxy]$/.test(w)) {
    forms.add(`${w}${w.slice(-1)}ed`);
    forms.add(`${w}${w.slice(-1)}ing`);
  }
  return [...forms];
}

const headForms = (word) => [...new Set([...wordForms(word.word), ...wordForms(word.lemma)])];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Find the word (or one of its inflections) in a sentence. Returns { before, match, after } or null.
export function findBlank(text, forms) {
  const t = String(text ?? "");
  const list = [...new Set(forms.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!t || list.length === 0) return null;
  const alt = list.map((f) => escapeRe(f).replace(/\s+/g, "\\s+")).join("|");
  const m = new RegExp(`(^|[^\\p{L}\\p{N}])(${alt})(?![\\p{L}\\p{N}])`, "iu").exec(t);
  if (!m) return null;
  const start = m.index + m[1].length;
  return { before: t.slice(0, start), match: m[2], after: t.slice(start + m[2].length) };
}

// ---- Which kind of exercise ----

export const KINDS = ["flashcard", "choice", "fill", "type"];
const KIND_FOR_BOX = { 1: "flashcard", 2: "flashcard", 3: "choice", 4: "fill", 5: "type" };
const FALLBACK_CHAIN = ["type", "fill", "choice", "flashcard"]; // when data is missing, step down this list

export const kindForBox = (box) => KIND_FOR_BOX[box] ?? "flashcard";
export const hasMeaning = (word) => normalizeText(word.meaningVi) !== "";

// Other cards whose meaning can serve as a wrong answer: they have a meaning and it differs from this word's.
export function distractorPool(word, vocab) {
  const own = normalizeText(word.meaningVi);
  const seen = new Set([own]);
  const pool = [];
  for (const v of vocab) {
    const m = normalizeText(v.meaningVi);
    if (v.deleted || v.id === word.id || !m || seen.has(m)) continue;
    seen.add(m);
    pool.push(v);
  }
  return pool;
}

const contextsWithWord = (word) => (word.contexts ?? []).filter((c) => findBlank(c.sentence, headForms(word)));
const collocationsWithWord = (word) => (word.collocations ?? []).filter((c) => findBlank(c, headForms(word)));

export function canUseKind(kind, word, vocab) {
  if (kind === "flashcard") return true;
  if (!hasMeaning(word)) return false; // a word without a meaning is only ever a flashcard
  if (kind === "choice") return distractorPool(word, vocab).length >= 3;
  if (kind === "fill") return contextsWithWord(word).length > 0;
  if (kind === "type") return collocationsWithWord(word).length > 0;
  return false;
}

// The exercise for a card: the kind of its box, or the nearest easier kind that its data allows.
export function chooseKind(word, vocab) {
  const start = FALLBACK_CHAIN.indexOf(kindForBox(word.box));
  for (let i = Math.max(0, start); i < FALLBACK_CHAIN.length; i++) {
    if (canUseKind(FALLBACK_CHAIN[i], word, vocab)) return FALLBACK_CHAIN[i];
  }
  return "flashcard";
}

// ---- Building a question ----

export function shuffle(list, rng = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pick = (list, rng) => list[Math.floor(rng() * list.length)];

// Returns the question object for `kind`. `rng` returns a number in [0, 1) (inject one in tests).
// For "type" the collocation shown is chosen at random; the one used last time (word.lastCollocation) is avoided
// when there is another to choose from.
export function buildQuestion(word, kind, vocab, { rng = Math.random } = {}) {
  const forms = headForms(word);
  const withWord = contextsWithWord(word);
  const common = {
    kind, wordId: word.id, word: word.word, ipa: word.ipa ?? "", pos: word.pos ?? "", meaningVi: word.meaningVi ?? "",
    hasMeaning: hasMeaning(word), box: word.box ?? 1,
    collocations: [...(word.collocations ?? [])], synonyms: [...(word.synonyms ?? [])],
  };

  if (kind === "flashcard") {
    const ctx = withWord[0] ?? (word.contexts ?? [])[0] ?? null;
    return { ...common, context: ctx ? { sentence: ctx.sentence, source: ctx.source ?? null } : null,
      contexts: (word.contexts ?? []).map((c) => ({ sentence: c.sentence, source: c.source ?? null })) };
  }

  if (kind === "choice") {
    const wrong = shuffle(distractorPool(word, vocab), rng).slice(0, 3);
    const options = shuffle([{ text: word.meaningVi, correct: true }, ...wrong.map((w) => ({ text: w.meaningVi, correct: false }))], rng);
    const ctx = withWord[0] ?? null;
    return { ...common, options, correctIndex: options.findIndex((o) => o.correct),
      context: ctx ? { ...findBlank(ctx.sentence, forms), source: ctx.source ?? null } : null };
  }

  if (kind === "fill") {
    const ctx = pick(withWord, rng);
    const blank = findBlank(ctx.sentence, forms);
    return { ...common, ...blank, source: ctx.source ?? null, accepted: [...new Set([normalizeText(blank.match), ...forms])] };
  }

  // type: one saved collocation with the main word hidden
  const all = collocationsWithWord(word);
  const fresh = all.filter((c) => normalizeText(c) !== normalizeText(word.lastCollocation));
  const collocation = pick(fresh.length ? fresh : all, rng);
  const blank = findBlank(collocation, forms);
  return { ...common, collocation, ...blank, accepted: [...new Set([normalizeText(blank.match), ...forms])], phrase: collocation };
}

// ---- Grading ----

// Flashcard self-rating -> outcome.
export const RATING_OUTCOME = { forgot: "wrong", vague: "near", good: "correct" };

// input: for "choice" the index of the chosen option; for "fill" / "type" the typed text; for "flashcard" a rating
// ("forgot" | "vague" | "good"). Returns "correct" | "near" | "wrong".
// Using the extra-letters hint turns a correct typed answer into "near": the box stays.
export function gradeAnswer(question, input, { hintsUsed = 0 } = {}) {
  let outcome;
  if (question.kind === "flashcard") outcome = RATING_OUTCOME[input] ?? "wrong";
  else if (question.kind === "choice") outcome = Number(input) === question.correctIndex ? "correct" : "wrong";
  else if (question.kind === "fill") outcome = matchGrade(input, question.accepted);
  else {
    const byWord = matchGrade(input, question.accepted);
    const byPhrase = matchGrade(input, [question.phrase]);
    outcome = [byWord, byPhrase].includes("correct") ? "correct" : [byWord, byPhrase].includes("near") ? "near" : "wrong";
  }
  if (outcome === "correct" && hintsUsed > 0 && (question.kind === "fill" || question.kind === "type")) return "near";
  return outcome;
}

// New Leitner fields for a card after an answer (spec 6.3):
//   correct -> up one box; near -> same box, review again tomorrow; wrong -> box 1, lapses + 1.
export function applyOutcome(word, outcome, today = isoDate()) {
  const box = word.box ?? 1;
  const base = { lastReviewedAt: today };
  if (outcome === "correct") {
    const up = Math.min(5, box + 1);
    return { ...base, box: up, nextReview: nextReviewDate(up, today), lapses: word.lapses ?? 0 };
  }
  if (outcome === "near") return { ...base, box, nextReview: addDays(today, 1), lapses: word.lapses ?? 0 };
  return { ...base, box: 1, nextReview: nextReviewDate(1, today), lapses: (word.lapses ?? 0) + 1 };
}

// The line shown after an answer. A wrong answer never says "Chính xác".
export function outcomeMessage(outcome, fromBox, toBox) {
  if (outcome === "correct") return fromBox === 5 ? "Đúng · giữ hộp 5, ôn lại sau 30 ngày" : `Đúng · lên hộp ${toBox}`;
  if (outcome === "near") return `Gần đúng · giữ hộp ${toBox}, ôn lại ngày mai`;
  return "Sai · từ này quay lại hộp 1";
}
