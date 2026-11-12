// Quick capture: saves a new word or error and records where it was met (spec 5.4, 6.5, 6.6).
import { list, put } from "./repo.js";
import { matchVocab, addContext, findErrorDuplicate, normalizeText } from "./dedupe.js";
import { isoDate, addDays } from "./leitner.js";

export class CaptureError extends Error {
  constructor(message) {
    super(message);
    this.name = "CaptureError";
  }
}

// source = { book, test, skill, part } or null. Empty strings become null; numbers stay numbers.
export function cleanSource(source) {
  if (!source || !source.book) return null;
  const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
  return { book: Number(source.book), test: num(source.test), skill: source.skill || null, part: source.part ? num(source.part) : null };
}

// How many saved items still wait for Claude (enriched: false), counted from the database.
export async function countPending() {
  const [vocab, errors] = await Promise.all([list("vocab"), list("errors")]);
  return vocab.filter((v) => !v.enriched).length + errors.filter((e) => !e.enriched).length;
}

// targetId: undefined = decide automatically; a card id = add to that card; null = make a new card.
// Returns { status: "created" | "merged" | "needs-choice", vocab?, matches?, contextAdded? }.
export async function saveWord({ text, sentence = "", source = null, targetId } = {}) {
  const word = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!word) throw new CaptureError("Nhập từ hoặc collocation.");
  const src = cleanSource(source);
  const ctxSentence = String(sentence ?? "").trim();
  const today = isoDate();

  const vocab = await list("vocab");
  const { kind, matches } = matchVocab(vocab, { lemma: word, pos: "" });
  if (kind === "multiple" && targetId === undefined) return { status: "needs-choice", matches };

  let target = null;
  if (typeof targetId === "string") {
    target = vocab.find((v) => v.id === targetId) ?? null;
    if (!target) throw new CaptureError("Không tìm thấy thẻ từ đã chọn.");
  } else if (targetId === undefined && (kind === "exact" || kind === "single")) {
    target = matches[0];
  }

  let saved;
  let contextAdded = false;
  if (target) {
    const { contexts, added } = addContext(target.contexts, { sentence: ctxSentence, source: src, date: today });
    contextAdded = added;
    saved = added ? await put("vocab", { ...target, contexts }) : target;
  } else {
    saved = await put("vocab", {
      word, lemma: normalizeText(word), pos: "", ipa: "", meaningVi: "", definitionEn: "", topic: "",
      collocations: [], synonyms: [],
      contexts: ctxSentence ? [{ sentence: ctxSentence, source: src, date: today }] : [],
      box: 1, nextReview: addDays(today, 1), lapses: 0, lastReviewedAt: null, enriched: false,
    });
    contextAdded = Boolean(ctxSentence);
  }

  // One occurrence per save, even when the word already existed.
  await put("occurrences", { itemType: "vocab", itemId: saved.id, source: src, sentence: ctxSentence, date: today });
  return { status: target ? "merged" : "created", vocab: saved, contextAdded };
}

// A hand-written error gets signature "pending:<id>" (set by repo.js) until Claude classifies it.
// The same wrong sentence again adds 1 to occurrences instead of making a second card.
// Returns { status: "created" | "repeated", error }.
export async function saveError({ original, corrected = "", type = "", source = null } = {}) {
  const wrong = String(original ?? "").trim();
  if (!wrong) throw new CaptureError("Nhập câu sai.");
  const right = String(corrected ?? "").trim();
  const src = cleanSource(source);
  const today = isoDate();

  const dup = findErrorDuplicate(await list("errors"), wrong);
  let saved;
  if (dup) {
    saved = await put("errors", {
      ...dup,
      occurrences: (Number(dup.occurrences) || 1) + 1,
      lastSeen: today,
      corrected: dup.corrected || right,
      type: dup.type || type,
    });
  } else {
    saved = await put("errors", {
      original: wrong, corrected: right, type, explanationVi: "", correctExample: "",
      occurrences: 1, firstSeen: today, lastSeen: today, status: "new", warmupStreak: 0, enriched: false,
    });
  }
  await put("occurrences", { itemType: "error", itemId: saved.id, source: src, sentence: wrong, date: today });
  return { status: dup ? "repeated" : "created", error: saved };
}
