// Operations behind the Vocabulary Bank. Views call this, not repo.js directly.
import { list, get, put, query, softDelete } from "./repo.js";
import { lemmaPosKey, normalizeText, unionStrings, addContext } from "./dedupe.js";
import { isoDate, nextReviewDate } from "./leitner.js";

export async function loadVocabData() {
  const [vocab, occurrences] = await Promise.all([list("vocab"), list("occurrences")]);
  return { vocab, occurrences: occurrences.filter((o) => o.itemType === "vocab") };
}

const splitLines = (text) => String(text ?? "").split(/\r?\n|;/).map((s) => s.trim()).filter(Boolean);
const splitList = (text) => String(text ?? "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
export { splitLines, splitList };

// The other card that already uses this lemma + pos, if any.
export async function findConflict(id, { lemma, pos }) {
  const key = lemmaPosKey(lemma, pos);
  const same = await query("vocab", "lemmaPos", key);
  return same.find((v) => v.id !== id);
}

// fields: word, lemma, pos, ipa, meaningVi, definitionEn, topic, collocations[], synonyms[].
// Throws RepoError (Vietnamese message) when lemma + pos belongs to another card; nothing is overwritten.
export async function updateVocab(id, fields) {
  const current = await get("vocab", id);
  if (!current) throw new Error("Từ này không còn trong kho.");
  const word = String(fields.word ?? "").trim().replace(/\s+/g, " ");
  if (!word) throw new Error("Từ không được để trống.");
  const lemma = normalizeText(fields.lemma) || normalizeText(word);
  return put("vocab", {
    ...current,
    word, lemma,
    pos: String(fields.pos ?? "").trim(),
    ipa: String(fields.ipa ?? "").trim(),
    meaningVi: String(fields.meaningVi ?? "").trim(),
    definitionEn: String(fields.definitionEn ?? "").trim(),
    topic: String(fields.topic ?? "").trim(),
    collocations: unionStrings(fields.collocations ?? []),
    synonyms: unionStrings(fields.synonyms ?? []),
  });
}

// Fold card `dropId` into card `keepId`: contexts, collocations, synonyms are joined; empty fields are filled
// from the dropped card; the lower box and earlier review date are kept (the learner knows it less well).
// Occurrences move to the kept card and the dropped card is deleted (tombstone).
export async function mergeVocab(keepId, dropId) {
  if (keepId === dropId) throw new Error("Không thể gộp một thẻ vào chính nó.");
  const [keep, drop] = await Promise.all([get("vocab", keepId), get("vocab", dropId)]);
  if (!keep || !drop) throw new Error("Không tìm thấy thẻ cần gộp.");

  let contexts = keep.contexts ?? [];
  for (const c of drop.contexts ?? []) contexts = addContext(contexts, c).contexts;
  const first = (a, b) => (a ? a : b ?? "");
  const merged = await put("vocab", {
    ...keep,
    contexts,
    collocations: unionStrings(keep.collocations, drop.collocations),
    synonyms: unionStrings(keep.synonyms, drop.synonyms),
    ipa: first(keep.ipa, drop.ipa),
    meaningVi: first(keep.meaningVi, drop.meaningVi),
    definitionEn: first(keep.definitionEn, drop.definitionEn),
    topic: first(keep.topic, drop.topic),
    box: Math.min(keep.box ?? 1, drop.box ?? 1),
    nextReview: [keep.nextReview, drop.nextReview].filter(Boolean).sort()[0] ?? keep.nextReview,
    lapses: (keep.lapses ?? 0) + (drop.lapses ?? 0),
    enriched: Boolean(keep.enriched && drop.enriched),
  });
  for (const occ of await query("occurrences", "itemId", dropId)) {
    await put("occurrences", { ...occ, itemId: keepId });
  }
  await softDelete("vocab", dropId);
  return merged;
}

// "Đánh dấu đã thuộc": box 5, next review in 30 days (spec 6.3).
export async function markLearned(ids) {
  const today = isoDate();
  let n = 0;
  for (const id of ids) {
    const v = await get("vocab", id);
    if (!v) continue;
    await put("vocab", { ...v, box: 5, nextReview: nextReviewDate(5, today) });
    n++;
  }
  return n;
}

export async function deleteVocab(ids) {
  let n = 0;
  for (const id of ids) if (await softDelete("vocab", id)) n++;
  return n;
}
