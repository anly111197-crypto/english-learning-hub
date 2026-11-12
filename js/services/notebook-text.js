// Text pasted from NotebookLM / Gemini Notebook: split by the labels KIẾN THỨC / VÍ DỤ / NGUỒN, and find
// things to attach a note to. Pure functions.
import { foldForSearch } from "./dedupe.js";

export const MAX_NOTE_CHARS = 20000;

// A label must start the line (after bullets or ** marks) and be followed by ":" or a dash, or end the line.
// So a normal sentence such as "Nguồn gốc của từ này..." is not mistaken for a label.
const LABEL_RE = /^[\s>#*_\-•]*(?:\*\*|__)?\s*(kiến thức|kien thuc|ví dụ|vi du|nguồn|nguon)\s*(?:\*\*|__)?\s*(?:(?:[:：]|[-–—])\s*(?:\*\*|__)?\s*(.*)|$)/iu;
const FIELD = { "kien thuc": "text", "vi du": "example", "nguon": "citation" };

// Returns { text, example, citation, hasLabels }. Text before the first label, and everything when there is
// no label at all, goes to KIẾN THỨC (text). A label that appears twice appends.
export function parseNotebookText(raw) {
  const lines = String(raw ?? "").normalize("NFC").replace(/\r\n?/g, "\n").split("\n");
  const buckets = { text: [], example: [], citation: [] };
  let current = "text";
  let hasLabels = false;
  for (const line of lines) {
    const m = LABEL_RE.exec(line);
    if (m) {
      hasLabels = true;
      current = FIELD[foldForSearch(m[1])];
      if (m[2]) buckets[current].push(m[2]);
    } else {
      buckets[current].push(line);
    }
  }
  const clean = (arr) => arr.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: clean(buckets.text), example: clean(buckets.example), citation: clean(buckets.citation), hasLabels };
}

// ---- Things a note can be attached to: a test, a word or an error ----

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// Returns up to `perKind` matches of each kind: { type: "test"|"vocab"|"error", id, label, hint }.
// Test ids look like "15-1". Every word of the query must match (case and diacritics ignored).
export function searchTargets(query, { vocab = [], errors = [] } = {}, perKind = 4) {
  const words = foldForSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const matches = (text) => words.every((w) => foldForSearch(text).includes(w));
  const out = [];
  for (let book = 19; book >= 10; book--) {
    for (let test = 1; test <= 4; test++) {
      if (out.filter((t) => t.type === "test").length >= perKind) break;
      if (matches(`cam ${book} test ${test}`)) out.push({ type: "test", id: `${book}-${test}`, label: `Cam ${book} · Test ${test}`, hint: "" });
    }
  }
  const add = (type, list, text, label, hint) => {
    let n = 0;
    for (const item of list) {
      if (n >= perKind) break;
      if (!item.deleted && matches(text(item))) {
        out.push({ type, id: item.id, label: clip(label(item), 70), hint: clip(hint(item) ?? "", 70) });
        n++;
      }
    }
  };
  add("vocab", vocab, (v) => `${v.word} ${v.meaningVi ?? ""}`, (v) => v.word, (v) => v.meaningVi);
  add("error", errors, (e) => `${e.original} ${e.corrected ?? ""}`, (e) => e.original, (e) => e.corrected);
  return out;
}
