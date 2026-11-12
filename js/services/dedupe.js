// Pure helpers for duplicate detection (spec 6.5).

export function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Lowercase, no diacritics: used for searching Vietnamese and English text alike.
export function foldForSearch(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();
}

// Unique key for a vocab entry: lowercase lemma + pos, e.g. "mitigate|verb".
// A missing pos gives "mitigate|".
export function lemmaPosKey(lemma, pos) {
  return `${normalizeText(lemma)}|${normalizeText(pos)}`;
}

// ---- Vocabulary ----

// Which existing card should a captured word go to? `vocab` = live cards only.
//   exact    a card with the same lemma and the same pos (an empty pos matches an empty pos)
//   single   pos not given and exactly one card has this lemma -> add the context to it
//   multiple pos not given and several cards (different pos) have this lemma -> ask the learner
//   none     no card yet
export function matchVocab(vocab, { lemma, pos = "" }) {
  const nl = normalizeText(lemma);
  const np = normalizeText(pos);
  const same = vocab.filter((v) => normalizeText(v.lemma ?? v.word) === nl);
  if (np !== "") {
    const exact = same.find((v) => normalizeText(v.pos) === np);
    return exact ? { kind: "exact", matches: [exact] } : { kind: "none", matches: [] };
  }
  const exactEmpty = same.find((v) => normalizeText(v.pos) === "");
  if (exactEmpty) return { kind: "exact", matches: [exactEmpty] };
  if (same.length === 1) return { kind: "single", matches: same };
  if (same.length > 1) return { kind: "multiple", matches: same };
  return { kind: "none", matches: [] };
}

export function sourceKey(source) {
  if (!source) return "";
  return [source.book ?? "", source.test ?? "", source.skill ?? "", source.part ?? ""].join("|");
}

// Same sentence from the same place counts as the same context.
export function contextKey(ctx) {
  return `${normalizeText(ctx?.sentence)}#${sourceKey(ctx?.source)}`;
}

// Returns { contexts, added }. Does not modify the input array.
export function addContext(contexts, ctx) {
  const list = Array.isArray(contexts) ? contexts : [];
  if (!normalizeText(ctx?.sentence)) return { contexts: list, added: false };
  const key = contextKey(ctx);
  if (list.some((c) => contextKey(c) === key)) return { contexts: list, added: false };
  return { contexts: [...list, ctx], added: true };
}

// Union of two string lists, ignoring case and extra spaces; keeps the first spelling.
export function unionStrings(a = [], b = []) {
  const seen = new Set();
  const out = [];
  for (const s of [...a, ...b]) {
    const k = normalizeText(s);
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(String(s).trim());
    }
  }
  return out;
}

// ---- Errors ----

// A hand-written error with exactly the same wrong sentence (case and spacing ignored) is the same error.
export function findErrorDuplicate(errors, original) {
  const key = normalizeText(original);
  if (!key) return undefined;
  return errors.find((e) => normalizeText(e.original) === key);
}
