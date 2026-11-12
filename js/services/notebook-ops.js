// Notebooks (NotebookLM / Gemini Notebook links) and the notes pasted from them (spec 5.3).
// The app never talks to NotebookLM: it stores a link the learner pastes and text the learner pastes.
import { list, put, query, softDelete } from "./repo.js";
import { isHttpsUrl } from "./practice-store.js";
import { MAX_NOTE_CHARS } from "./notebook-text.js";

// The 6 notebook groups (spec 5.3). Names and purposes are only starting text; the learner can edit them.
export const NOTEBOOK_DEFAULTS = [
  { group: "Writing", name: "IELTS Writing", purpose: "Ý tưởng, cấu trúc đoạn và cách diễn đạt cho Writing Task 1 và 2." },
  { group: "Speaking", name: "IELTS Speaking", purpose: "Ý tưởng, idioms và cách trả lời cho Speaking Part 1–3." },
  { group: "Vocabulary", name: "Vocabulary", purpose: "Từ vựng và collocation theo chủ đề." },
  { group: "Grammar", name: "Grammar", purpose: "Quy tắc ngữ pháp và cách sửa các lỗi hay gặp." },
  { group: "Cambridge Practice", name: "Cambridge Practice", purpose: "Ghi chú tự rút ra sau khi làm đề Cam 10–19." },
  { group: "Professional English", name: "Professional English", purpose: "Tài liệu văn phong học thuật và công việc." },
];

const groupOrder = (n) => NOTEBOOK_DEFAULTS.findIndex((d) => d.group === n.group);

// Creates the notebooks that do not exist yet; returns all of them in the order above.
export async function ensureNotebooks() {
  const existing = await list("notebooks");
  for (const def of NOTEBOOK_DEFAULTS) {
    if (existing.some((n) => n.group === def.group)) continue;
    try {
      await put("notebooks", { ...def, notebookUrl: "", sourceCount: 0 });
    } catch (e) {
      if (e.name !== "RepoError") throw e; // two tabs seeding at once: the other one won, that is fine
    }
  }
  return (await list("notebooks")).sort((a, b) => groupOrder(a) - groupOrder(b));
}

export async function loadNotebookData() {
  const [notebooks, notes] = await Promise.all([ensureNotebooks(), list("notes")]);
  return { notebooks, notes };
}

export async function updateNotebook(id, { name, purpose, sourceCount, notebookUrl }) {
  const current = (await list("notebooks")).find((n) => n.id === id);
  if (!current) throw new Error("Không tìm thấy notebook.");
  const url = String(notebookUrl ?? "").trim();
  if (url && !isHttpsUrl(url)) throw new Error("Link notebook phải bắt đầu bằng https://");
  const count = sourceCount === "" || sourceCount === null || sourceCount === undefined ? 0 : Number(sourceCount);
  if (!Number.isInteger(count) || count < 0 || count > 9999) throw new Error("Số nguồn phải là số nguyên từ 0 trở lên.");
  const cleanName = String(name ?? "").trim();
  if (!cleanName) throw new Error("Tên notebook không được để trống.");
  return put("notebooks", { ...current, name: cleanName, purpose: String(purpose ?? "").trim(), sourceCount: count, notebookUrl: url });
}

// links: [{ type: "test" | "vocab" | "error", id }]. The notebook itself is one more link ({ type: "notebook" }),
// because the notes record has no notebook field.
export async function saveNote({ notebookId, text = "", example = "", citation = "", links = [] }) {
  const clip = (s) => String(s ?? "").trim().slice(0, MAX_NOTE_CHARS);
  const note = { text: clip(text), example: clip(example), citation: clip(citation) };
  if (!note.text && !note.example && !note.citation) throw new Error("Note đang trống. Dán hoặc nhập nội dung trước.");
  if (!notebookId) throw new Error("Chọn notebook cho note này.");
  const seen = new Set();
  const all = [{ type: "notebook", id: notebookId }, ...links].filter((l) => {
    const k = `${l.type}:${l.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return put("notes", { ...note, origin: "notebooklm", links: all });
}

export const deleteNote = (id) => softDelete("notes", id);

// Notes attached to one thing (a test key like "15-1", a word id, an error id or a notebook id), newest first.
export function notesFor(notes, type, id) {
  return notes
    .filter((n) => !n.deleted && (n.links ?? []).some((l) => l.type === type && l.id === id))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// After two cards were merged: notes that pointed at the removed card now point at the kept one.
export async function repointNoteLinks(type, fromId, toId) {
  for (const note of await query("notes", "linkKeys", `${type}:${fromId}`)) {
    const seen = new Set();
    const links = note.links
      .map((l) => (l.type === type && l.id === fromId ? { ...l, id: toId } : l))
      .filter((l) => {
        const k = `${l.type}:${l.id}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    await put("notes", { ...note, links });
  }
}
