// Rules for grammar errors (spec 5.8, 6.4, 6.7). Pure functions, reused by the warm-up in Step 5.
import { foldForSearch } from "./dedupe.js";
import { addDays } from "./leitner.js";
import { ERROR_TYPES, errorTypeLabel } from "./taxonomy.js";

export const STATUSES = ["new", "practicing", "fixed", "recurring"];
export const STATUS_LABELS = { new: "Mới", practicing: "Đang luyện", fixed: "Đã khắc phục", recurring: "Lặp lại" };

// "Repeat alarm" (spec 5.8): at least 3 encounters within the last 14 days (today and the 13 days before).
export const ALARM_MIN_ENCOUNTERS = 3;
export const ALARM_WINDOW_DAYS = 14;

const num = (v) => Number(v) || 0;
const byId = (a, b) => String(a.id).localeCompare(String(b.id));
const isLive = (e) => !e.deleted;

// Unknown or empty type = "" ("Chưa rõ").
export const normalizeType = (type) => (ERROR_TYPES.some((t) => t.slug === type) ? type : "");

// ---- Status ----

// An error marked fixed that is written down again becomes "recurring"; other statuses stay as they are.
export const statusAfterRecurrence = (status) => (status === "fixed" ? "recurring" : status);

const SEVERITY = { recurring: 3, new: 2, practicing: 1 };

// Status of the card that is kept when two errors are merged.
//  both fixed -> fixed; one fixed and the other not -> the kept card is fixed: recurring, else keep's status;
//  neither fixed -> the more severe (recurring > new > practicing).
export function mergedStatus(keep, drop) {
  const keepFixed = keep === "fixed";
  const dropFixed = drop === "fixed";
  if (keepFixed && dropFixed) return "fixed";
  if (keepFixed) return "recurring";
  if (dropFixed) return keep;
  return (SEVERITY[keep] ?? 0) >= (SEVERITY[drop] ?? 0) ? keep : drop;
}

const earliest = (a, b) => [a, b].filter(Boolean).sort()[0] ?? "";
const latest = (a, b) => [a, b].filter(Boolean).sort().at(-1) ?? "";

// Fields of the kept error after folding `drop` into `keep` (spec 6.5: add occurrences). `signature` stays
// the kept card's: a deleted card keeps its signature, so taking it over would clash with the unique index.
export function mergeErrorFields(keep, drop) {
  const first = (a, b) => (a ? a : b ?? "");
  const status = mergedStatus(keep.status, drop.status);
  return {
    ...keep,
    original: first(keep.original, drop.original),
    corrected: first(keep.corrected, drop.corrected),
    explanationVi: first(keep.explanationVi, drop.explanationVi),
    correctExample: first(keep.correctExample, drop.correctExample),
    type: first(keep.type, drop.type),
    occurrences: num(keep.occurrences) + num(drop.occurrences),
    firstSeen: earliest(keep.firstSeen, drop.firstSeen),
    lastSeen: latest(keep.lastSeen, drop.lastSeen),
    status,
    warmupStreak: Math.min(num(keep.warmupStreak), num(drop.warmupStreak)),
    enriched: Boolean(keep.enriched && drop.enriched),
  };
}

// ---- Warm-up selection (spec 6.4) ----

// Up to n errors that are not fixed: most occurrences first, then the most recently seen.
export function pickWarmupErrors(errors, n = 5) {
  return errors
    .filter((e) => isLive(e) && e.status !== "fixed")
    .sort((a, b) => num(b.occurrences) - num(a.occurrences) || String(b.lastSeen ?? "").localeCompare(String(a.lastSeen ?? "")) || byId(a, b))
    .slice(0, n);
}

// ---- Numbers for the four cards ----

// errors: live errors; occurrences: occurrence records of type "error"; today: "yyyy-mm-dd".
export function summarizeErrors(errors, occurrences, today) {
  const live = errors.filter(isLive);
  const total = live.length;
  const byType = {};
  for (const e of live) byType[normalizeType(e.type)] = (byType[normalizeType(e.type)] ?? 0) + 1;

  let top = null;
  for (const slug of [...ERROR_TYPES.map((t) => t.slug), ""]) {
    const count = byType[slug] ?? 0;
    if (count > 0 && (!top || count > top.count)) top = { slug, label: errorTypeLabel(slug), count };
  }
  if (top) top.share = Math.round((top.count / total) * 100);

  const fixed = live.filter((e) => e.status === "fixed").length;

  const windowStart = addDays(today, -(ALARM_WINDOW_DAYS - 1));
  const recent = new Map();
  for (const o of occurrences) {
    if (o.deleted || o.itemType !== "error" || !o.date) continue;
    if (o.date >= windowStart && o.date <= today) recent.set(o.itemId, (recent.get(o.itemId) ?? 0) + 1);
  }
  const alarm = live.filter((e) => e.status !== "fixed" && (recent.get(e.id) ?? 0) >= ALARM_MIN_ENCOUNTERS).length;

  return {
    total,
    totalOccurrences: live.reduce((s, e) => s + num(e.occurrences), 0),
    typesUsed: Object.keys(byType).length,
    byType,
    top,
    fixed,
    fixedPct: total ? Math.round((fixed / total) * 100) : 0,
    alarm,
  };
}

// ---- List: filter and sort ----

// type: null = every type, "" = "Chưa rõ", or a slug. status: null | "all" | a status. q: search text.
export function filterErrors(errors, { type = null, status = null, q = "" } = {}) {
  const needle = foldForSearch(q).trim();
  return errors.filter((e) => {
    if (e.deleted) return false;
    if (type !== null && normalizeType(e.type) !== type) return false;
    if (status && status !== "all" && e.status !== status) return false;
    if (needle) {
      const hay = foldForSearch([e.original, e.corrected, e.explanationVi, e.correctExample, errorTypeLabel(e.type)].join(" "));
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

// key: "occurrences" (most repeated first) or "recent" (most recently seen first). Returns a new array.
export function sortErrors(errors, key = "occurrences") {
  const seen = (a, b) => String(b.lastSeen ?? "").localeCompare(String(a.lastSeen ?? ""));
  const times = (a, b) => num(b.occurrences) - num(a.occurrences);
  return [...errors].sort((a, b) => (key === "recent" ? seen(a, b) || times(a, b) : times(a, b) || seen(a, b)) || byId(a, b));
}
