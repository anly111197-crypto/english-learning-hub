// "Hoàn thiện với Claude" (spec 6.6): which items go to Claude, how the answer is lined up with them, and what is saved.
// Pure: no IndexedDB, no DOM. The database part is in enrich-ops.js.
import { MAX_ENRICH_BATCH, POS_VALUES, ERROR_TYPE_SLUGS } from "../ai/schema.js";
import { lemmaPosKey, normalizeText, unionStrings } from "./dedupe.js";

const isLive = (r) => r && !r.deleted;
const byCreated = (a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) || String(a.id).localeCompare(String(b.id));

export const pendingCount = (records) => records.filter((r) => isLive(r) && !r.enriched).length;

// At most `max` items for one task. With selectedIds: those items (even when already completed); otherwise the oldest
// items that still wait for Claude.
export function pickBatch(records, { selectedIds = null, max = MAX_ENRICH_BATCH } = {}) {
  const live = records.filter(isLive);
  if (selectedIds && selectedIds.length) {
    const wanted = new Set(selectedIds);
    return live.filter((r) => wanted.has(r.id)).sort(byCreated).slice(0, max);
  }
  return live.filter((r) => !r.enriched).sort(byCreated).slice(0, max);
}

// What is sent to Claude: only what the learner typed. The context is the latest sentence they wrote for the word.
export function vocabPromptItems(batch) {
  return batch.map((v) => {
    const sentences = (v.contexts ?? []).map((c) => String(c?.sentence ?? "").trim()).filter(Boolean);
    return { id: v.id, word: v.word ?? v.lemma, context: sentences.at(-1) ?? "" };
  });
}

export const errorPromptItems = (batch) => batch.map((e) => ({ id: e.id, original: e.original, corrected: String(e.corrected ?? "").trim() }));

// Signatures already in use (Claude must pick from these when one fits). Hand-written errors still have "pending:<id>".
export function knownSignatures(errors) {
  return unionStrings(errors.filter((e) => isLive(e) && !String(e.signature ?? "").startsWith("pending:")).map((e) => e.signature));
}

// ---- Lining the answer up with the batch ----

// items: validated items from parseEnrichResult. Returns rows in batch order for the items Claude answered,
// each with the editable `values` (Claude's answer) and `have` (what the card already holds).
export function buildVocabRows(batch, items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  return batch.filter((v) => byId.has(v.id)).map((v) => {
    const it = byId.get(v.id);
    return {
      id: v.id, record: v, label: v.word ?? v.lemma, noteVi: it.noteVi,
      values: { lemma: it.lemma, pos: it.pos, ipa: it.ipa, meaningVi: it.meaningVi, collocations: it.collocations, example: it.example, wordFamily: it.wordFamily, noteVi: it.noteVi },
      have: { ipa: v.ipa ?? "", meaningVi: v.meaningVi ?? "", collocations: v.collocations ?? [] },
    };
  });
}

export function buildErrorRows(batch, items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  return batch.filter((e) => byId.has(e.id)).map((e) => {
    const it = byId.get(e.id);
    return {
      id: e.id, record: e, label: e.original,
      values: { type: it.type, signature: it.signature, corrected: it.corrected, explanationVi: it.explanationVi, correctExample: it.correctExample },
      have: { type: e.type ?? "", corrected: e.corrected ?? "" },
    };
  });
}

// ---- Duplicates after completing (spec 6.5) ----

// The OTHER live card that already has this lemma + pos (the new card folds into it), or undefined.
export function findVocabConflict(vocab, id, lemma, pos) {
  const key = lemmaPosKey(lemma, pos);
  return vocab.find((v) => isLive(v) && v.id !== id && lemmaPosKey(v.lemma ?? v.word, v.pos) === key);
}

export function findErrorConflict(errors, id, signature) {
  const key = normalizeText(signature);
  return errors.find((e) => isLive(e) && e.id !== id && normalizeText(e.signature) === key);
}

// ---- Checks on the (possibly edited) values before saving ----

export function validateVocabValues(v) {
  if (!normalizeText(v.lemma)) return "Cần có lemma.";
  if (!POS_VALUES.includes(v.pos)) return "Loại từ không hợp lệ.";
  if (!String(v.meaningVi ?? "").trim()) return "Cần có nghĩa tiếng Việt.";
  return "";
}

export function validateErrorValues(v) {
  if (!ERROR_TYPE_SLUGS.includes(v.type)) return "Chọn nhóm lỗi.";
  const sig = normalizeText(v.signature).replace(/\s/g, "");
  const colon = sig.indexOf(":");
  if (colon < 1 || colon === sig.length - 1) return 'Signature phải có dạng "nhóm:quy-tắc".';
  if (sig.slice(0, colon) !== v.type) return `Signature phải bắt đầu bằng "${v.type}:".`;
  if (!String(v.corrected ?? "").trim()) return "Cần có câu sửa.";
  return "";
}

// ---- What gets written ----

// A misspelling note means the typed word was wrong, so the card takes the corrected spelling as its word
// (flashcards must not show the misspelling). Otherwise the word stays as the learner typed it.
// Collocations and word family are added to what the card already has, never replacing it.
export function vocabFieldsToSave(cur, v) {
  const lemma = normalizeText(v.lemma);
  return {
    word: v.noteVi ? String(v.lemma).trim() : cur.word,
    lemma,
    pos: v.pos,
    ipa: String(v.ipa ?? "").trim(),
    meaningVi: String(v.meaningVi ?? "").trim(),
    collocations: unionStrings(cur.collocations, v.collocations),
    exampleEn: String(v.example ?? "").trim() || cur.exampleEn || "",
    wordFamily: unionStrings(cur.wordFamily, v.wordFamily),
  };
}

export function errorFieldsToSave(v) {
  return {
    type: v.type,
    signature: normalizeText(v.signature).replace(/\s/g, ""),
    corrected: String(v.corrected ?? "").trim(),
    explanationVi: String(v.explanationVi ?? "").trim(),
    correctExample: String(v.correctExample ?? "").trim(),
  };
}
