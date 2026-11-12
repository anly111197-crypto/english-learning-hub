// Pure description of the data model (spec 7.1). No IndexedDB here, so node --test can import it.
import { lemmaPosKey } from "./dedupe.js";

export const APP_ID = "english-learning-hub";
export const SCHEMA_VERSION = 2;
export const DB_NAME = "elh";

const idx = (name, extra = {}) => ({ name, keyPath: name, unique: false, multiEntry: false, ...extra });

export const STORE_DEFS = {
  vocab: { keyPath: "id", indexes: [idx("lemmaPos", { unique: true }), idx("nextReview"), idx("box"), idx("topic")] },
  errors: { keyPath: "id", indexes: [idx("signature", { unique: true }), idx("type"), idx("status"), idx("occurrences")] },
  occurrences: { keyPath: "id", indexes: [idx("itemId"), idx("submissionId")] },
  attempts: { keyPath: "id", indexes: [idx("bookTest", { keyPath: ["book", "test"] }), idx("skill")] },
  tests: { keyPath: "key", indexes: [] },
  submissions: { keyPath: "id", indexes: [idx("kind"), idx("createdAt")] },
  sessions: { keyPath: "id", indexes: [idx("date")] },
  exercises: { keyPath: "id", indexes: [idx("errorIds", { multiEntry: true })] },
  notebooks: { keyPath: "id", indexes: [idx("group", { unique: true })] },
  notes: { keyPath: "id", indexes: [idx("linkKeys", { multiEntry: true })] },
};

export const STORE_NAMES = Object.keys(STORE_DEFS);
export const KEY_FIELD = Object.fromEntries(STORE_NAMES.map((s) => [s, STORE_DEFS[s].keyPath]));

// Stores whose records are unique by a natural key (in addition to id).
export const NATURAL_KEY = {
  vocab: { field: "lemmaPos" },
  errors: { field: "signature" },
  notebooks: { field: "group" },
};

// Fill fields that exist only to support indexes. Mutates and returns `rec`.
// Throws a plain Error (Vietnamese message) when a required field is missing.
export function withDerived(store, rec) {
  if (store === "vocab") {
    const lemma = rec.lemma ?? rec.word;
    if (typeof lemma !== "string" || !lemma.trim()) throw new Error("Từ vựng cần có lemma hoặc word.");
    rec.lemmaPos = lemmaPosKey(lemma, rec.pos);
  } else if (store === "errors") {
    if (typeof rec.signature !== "string" || !rec.signature.trim()) rec.signature = `pending:${rec.id}`;
  } else if (store === "notebooks") {
    if (typeof rec.group !== "string" || !rec.group.trim()) throw new Error("Notebook cần có group.");
  } else if (store === "notes") {
    // Spec says "idx links (multiEntry)", but links are objects and cannot be index keys.
    rec.linkKeys = (Array.isArray(rec.links) ? rec.links : []).map((l) => `${l.type}:${l.id}`);
  }
  return rec;
}
