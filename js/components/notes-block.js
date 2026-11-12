// "Note đã gắn": notes pasted from NotebookLM / Gemini Notebook that are attached to a test, word or error.
// All text is inserted as text, never as HTML.
import { h, formatDateVi } from "./dom.js";

const SECTIONS = [
  ["text", "KIẾN THỨC"],
  ["example", "VÍ DỤ"],
  ["citation", "NGUỒN"],
];

export function noteNode(note, notebooks) {
  const nbLink = (note.links ?? []).find((l) => l.type === "notebook");
  const nb = notebooks.find((n) => n.id === nbLink?.id);
  return h("article", { class: "note" },
    h("p", { class: "note-head" },
      h("span", { class: "chip nowrap" }, nb?.name ?? "Notebook"),
      h("span", { class: "muted nowrap" }, ` ${formatDateVi(String(note.createdAt ?? "").slice(0, 10))}`)),
    SECTIONS.filter(([key]) => note[key]).map(([key, label]) => h("div", { class: "note-section" },
      h("p", { class: "note-label" }, label),
      h("p", { class: "note-text" }, note[key]))));
}

// Returns an array of nodes: a heading and the notes (or a short "none" line).
export function notesBlock(notes, notebooks) {
  return [
    h("h3", { class: "section-label" }, `Note đã gắn${notes.length ? ` (${notes.length})` : ""}`),
    notes.length
      ? h("div", { class: "notes-list" }, notes.map((n) => noteNode(n, notebooks)))
      : h("p", { class: "muted" }, "Chưa có note."),
  ];
}
