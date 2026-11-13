// Database side of "Hoàn thiện với Claude" (spec 6.6). Views call this, not repo.js directly.
import { list, get, put, query, softDelete } from "./repo.js";
import { lemmaPosKey } from "./dedupe.js";
import { mergeVocab } from "./vocab-ops.js";
import { mergeErrors } from "./error-ops.js";
import { repointNoteLinks } from "./notebook-ops.js";
import {
  pickBatch, pendingCount, vocabPromptItems, errorPromptItems, knownSignatures,
  buildVocabRows, buildErrorRows, findVocabConflict, findErrorConflict, vocabFieldsToSave, errorFieldsToSave,
} from "./enrich.js";

export async function countPendingByKind() {
  const [vocab, errors] = await Promise.all([list("vocab"), list("errors")]);
  return { vocab: pendingCount(vocab), errors: pendingCount(errors) };
}

// Everything the dialog needs: the batch (<= 20), what goes into the prompt, and all live cards for the duplicate hints.
export async function loadEnrichBatch(kind, selectedIds = null) {
  if (kind === "vocab") {
    const all = await list("vocab");
    const batch = pickBatch(all, { selectedIds });
    return { kind, batch, all, pending: pendingCount(all), input: { items: vocabPromptItems(batch) } };
  }
  const all = await list("errors");
  const batch = pickBatch(all, { selectedIds });
  return { kind, batch, all, pending: pendingCount(all), input: { items: errorPromptItems(batch), signatures: knownSignatures(all) } };
}

export const rowsFor = (kind, batch, items) => (kind === "vocab" ? buildVocabRows(batch, items) : buildErrorRows(batch, items));

// Move what points at card `fromId` to card `toId` (used when a card changes identity through a deleted card's key).
async function repoint(store, itemType, fromId, toId) {
  for (const occ of await query("occurrences", "itemId", fromId)) await put("occurrences", { ...occ, itemId: toId });
  await repointNoteLinks(itemType, fromId, toId);
  await softDelete(store, fromId);
}

// Same key as a card that was deleted earlier: put() gives the new record the deleted card's identity.
const withoutIdentity = ({ id, createdAt, updatedAt, ...rest }) => rest;

// row: { id, values }. Returns { status: "enriched" | "merged" | "gone", into? }.
export async function saveVocabRow(row) {
  const cur = await get("vocab", row.id);
  if (!cur) return { status: "gone" };
  const patch = vocabFieldsToSave(cur, row.values);
  const conflict = findVocabConflict(await list("vocab"), cur.id, patch.lemma, patch.pos);

  if (conflict) {
    // The existing card keeps its box, review date and lapses; this card's contexts, occurrences and links move to it.
    await put("vocab", { ...cur, ipa: patch.ipa, meaningVi: patch.meaningVi, collocations: patch.collocations, exampleEn: patch.exampleEn, wordFamily: patch.wordFamily, enriched: true });
    const merged = await mergeVocab(conflict.id, cur.id, { keepProgress: true });
    await put("vocab", { ...merged, enriched: true });
    return { status: "merged", into: merged.word };
  }

  const key = lemmaPosKey(patch.lemma, patch.pos);
  const tomb = (await query("vocab", "lemmaPos", key, { includeDeleted: true })).find((v) => v.deleted && v.id !== cur.id);
  if (tomb) {
    const saved = await put("vocab", { ...withoutIdentity(cur), ...patch, enriched: true });
    await repoint("vocab", "vocab", cur.id, saved.id);
    return { status: "enriched" };
  }
  await put("vocab", { ...cur, ...patch, enriched: true });
  return { status: "enriched" };
}

export async function saveErrorRow(row) {
  const cur = await get("errors", row.id);
  if (!cur) return { status: "gone" };
  const patch = errorFieldsToSave(row.values);
  const conflict = findErrorConflict(await list("errors"), cur.id, patch.signature);

  if (conflict) {
    // Same rule as an error already in the notebook: occurrences are added (mergeErrorFields), the old card stays.
    await put("errors", { ...cur, type: patch.type, corrected: patch.corrected, explanationVi: patch.explanationVi, correctExample: patch.correctExample, enriched: true });
    const merged = await mergeErrors(conflict.id, cur.id);
    await put("errors", { ...merged, enriched: true });
    return { status: "merged", into: merged.original };
  }

  const tomb = (await query("errors", "signature", patch.signature, { includeDeleted: true })).find((e) => e.deleted && e.id !== cur.id);
  if (tomb) {
    const saved = await put("errors", { ...withoutIdentity(cur), ...patch, enriched: true });
    for (const ex of await query("exercises", "errorIds", cur.id)) {
      await put("exercises", { ...ex, errorIds: [...new Set(ex.errorIds.map((id) => (id === cur.id ? saved.id : id)))] });
    }
    await repoint("errors", "error", cur.id, saved.id);
    return { status: "enriched" };
  }
  await put("errors", { ...cur, ...patch, enriched: true });
  return { status: "enriched" };
}

// Saves the rows one by one; one failing row does not stop the others. Returns the counts and the failures.
export async function saveRows(kind, rows) {
  const out = { enriched: 0, merged: 0, gone: 0, failed: [] };
  for (const row of rows) {
    try {
      const res = await (kind === "vocab" ? saveVocabRow(row) : saveErrorRow(row));
      out[res.status] += 1;
    } catch (e) {
      out.failed.push({ id: row.id, message: e?.message || "Không lưu được." });
    }
  }
  return out;
}
