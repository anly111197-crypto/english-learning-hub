// Operations behind the Vocabulary Bank. Views call this, not repo.js directly.
import { list, get, put, query, softDelete } from "./repo.js";
import { lemmaPosKey, normalizeText, unionStrings, addContext } from "./dedupe.js";
import { isoDate, nextReviewDate } from "./leitner.js";
import { repointNoteLinks } from "./notebook-ops.js";
import { mergeVocabFields } from "./vocab-merge.js";

export async function loadVocabData() {
  const [vocab, occurrences, notes, notebooks] = await Promise.all([list("vocab"), list("occurrences"), list("notes"), list("notebooks")]);
  return { vocab, occurrences: occurrences.filter((o) => o.itemType === "vocab"), notes, notebooks };
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

// Fold card `dropId` into card `keepId` (fields: see mergeVocabFields; keepProgress leaves the kept card's box alone).
// Occurrences move to the kept card and the dropped card is deleted (tombstone).
export async function mergeVocab(keepId, dropId, { keepProgress = false } = {}) {
  if (keepId === dropId) throw new Error("Không thể gộp một thẻ vào chính nó.");
  const [keep, drop] = await Promise.all([get("vocab", keepId), get("vocab", dropId)]);
  if (!keep || !drop) throw new Error("Không tìm thấy thẻ cần gộp.");
  const merged = await put("vocab", mergeVocabFields(keep, drop, { keepProgress }));
  for (const occ of await query("occurrences", "itemId", dropId)) {
    await put("occurrences", { ...occ, itemId: keepId });
  }
  await repointNoteLinks("vocab", dropId, keepId);
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
