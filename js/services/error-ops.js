// Operations behind the Grammar Notebook. Views call this, not repo.js directly.
import { list, get, put, query, softDelete } from "./repo.js";
import { STATUSES, mergeErrorFields } from "./errors.js";
import { repointNoteLinks } from "./notebook-ops.js";

export async function loadErrorData() {
  const [errors, occurrences, notes, notebooks] = await Promise.all([list("errors"), list("occurrences"), list("notes"), list("notebooks")]);
  return { errors, occurrences: occurrences.filter((o) => o.itemType === "error"), notes, notebooks };
}

// fields: corrected, type, explanationVi, correctExample, status. The wrong sentence is not editable: it is how
// the same error is recognised when it is written down again.
export async function updateError(id, fields) {
  const current = await get("errors", id);
  if (!current) throw new Error("Lỗi này không còn trong sổ.");
  if (fields.status !== undefined && !STATUSES.includes(fields.status)) throw new Error("Trạng thái không hợp lệ.");
  const trim = (v, fallback) => (v === undefined ? fallback : String(v).trim());
  return put("errors", {
    ...current,
    corrected: trim(fields.corrected, current.corrected),
    type: trim(fields.type, current.type),
    explanationVi: trim(fields.explanationVi, current.explanationVi),
    correctExample: trim(fields.correctExample, current.correctExample),
    status: fields.status ?? current.status,
  });
}

export async function setStatus(ids, status) {
  if (!STATUSES.includes(status)) throw new Error("Trạng thái không hợp lệ.");
  let n = 0;
  for (const id of ids) {
    const e = await get("errors", id);
    if (!e) continue;
    await put("errors", { ...e, status });
    n++;
  }
  return n;
}

// Fold error `dropId` into error `keepId`: occurrences are added, encounter records (and notes, exercises)
// are pointed at the kept error, and the dropped one is deleted (tombstone).
export async function mergeErrors(keepId, dropId) {
  if (keepId === dropId) throw new Error("Không thể gộp một lỗi vào chính nó.");
  const [keep, drop] = await Promise.all([get("errors", keepId), get("errors", dropId)]);
  if (!keep || !drop) throw new Error("Không tìm thấy lỗi cần gộp.");
  const merged = await put("errors", mergeErrorFields(keep, drop));
  for (const occ of await query("occurrences", "itemId", dropId)) await put("occurrences", { ...occ, itemId: keepId });
  for (const ex of await query("exercises", "errorIds", dropId)) {
    await put("exercises", { ...ex, errorIds: [...new Set(ex.errorIds.map((id) => (id === dropId ? keepId : id)))] });
  }
  await repointNoteLinks("error", dropId, keepId);
  await softDelete("errors", dropId);
  return merged;
}

export async function deleteErrors(ids) {
  let n = 0;
  for (const id of ids) if (await softDelete("errors", id)) n++;
  return n;
}
