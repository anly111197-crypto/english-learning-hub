// Pure helpers for duplicate detection (spec 6.5). More logic arrives in Step 4.

export function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Unique key for a vocab entry: lowercase lemma + pos, e.g. "mitigate|verb".
// A missing pos gives "mitigate|" (matching by lemma only is Step 4).
export function lemmaPosKey(lemma, pos) {
  return `${normalizeText(lemma)}|${normalizeText(pos)}`;
}
