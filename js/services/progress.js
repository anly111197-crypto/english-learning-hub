// Turns attempts into the matrix, counts and averages shown on Cambridge Practice. Pure functions.
import { writingEstimate, overallBand, roundBand } from "./bands.js";

export const BOOKS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
export const TESTS = [1, 2, 3, 4];
export const SKILLS = ["L", "R", "W", "S"];
export const SKILL_NAMES = { L: "Listening", R: "Reading", W: "Writing", S: "Speaking" };
export const IMPROVE_BELOW = 6.5;

const ts = (s) => {
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
};

export const testKey = (book, test) => `${book}-${test}`;

// Map "15-3" -> { L, R, S, W1, W2 } (attempt records). Deleted records are ignored; if the same slot
// has several records, the most recently updated one wins.
export function indexAttempts(attempts) {
  const index = new Map();
  for (const a of attempts) {
    if (a.deleted) continue;
    const slot = a.skill === "W" ? `W${a.task === 1 ? 1 : 2}` : a.skill;
    if (!["L", "R", "S", "W1", "W2"].includes(slot)) continue;
    const key = testKey(a.book, a.test);
    const entry = index.get(key) ?? {};
    if (!entry[slot] || ts(a.updatedAt) >= ts(entry[slot].updatedAt)) entry[slot] = a;
    index.set(key, entry);
  }
  return index;
}

// Bands of one test. W is the estimate (see writingEstimate).
export function testSummary(entry = {}) {
  const w = writingEstimate(entry.W1?.band, entry.W2?.band);
  const bands = { L: entry.L?.band ?? null, R: entry.R?.band ?? null, W: w?.value ?? null, S: entry.S?.band ?? null };
  const done = SKILLS.filter((k) => bands[k] !== null).length;
  return { bands, writing: w, skillsDone: done, overall: overallBand(bands) };
}

// "Done" = has both Listening and Reading (spec 6.2 treats L/R as doing the test).
export const isTestDone = (entry) => Boolean(entry?.L && entry?.R);

export function booksDoneCount(index, book) {
  return TESTS.filter((t) => isTestDone(index.get(testKey(book, t)))).length;
}

export function totalDone(index, books = BOOKS) {
  return books.reduce((sum, b) => sum + booksDoneCount(index, b), 0);
}

// Average band per skill over all tests that have it, rounded by rule 6.1 for display.
export function skillAverages(index) {
  const sums = { L: [], R: [], W: [], S: [] };
  for (const entry of index.values()) {
    const { bands } = testSummary(entry);
    for (const k of SKILLS) if (bands[k] !== null) sums[k].push(bands[k]);
  }
  const avg = {};
  for (const k of SKILLS) {
    avg[k] = sums[k].length ? sums[k].reduce((a, b) => a + b, 0) / sums[k].length : null;
  }
  return avg;
}

export function averageSummary(index) {
  const raw = skillAverages(index);
  const rounded = Object.fromEntries(SKILLS.map((k) => [k, raw[k] === null ? null : roundBand(raw[k])]));
  const withData = SKILLS.filter((k) => raw[k] !== null);
  let weakest = null;
  if (withData.length >= 2) {
    weakest = withData.reduce((low, k) => (raw[k] < raw[low] ? k : low));
  }
  return { rounded, overall: overallBand(rounded), weakest, weakestBand: weakest ? rounded[weakest] : null };
}

// Number of (test, skill) cells with a band below 6.5.
export function countNeedsImprovement(index) {
  let n = 0;
  for (const entry of index.values()) {
    const { bands } = testSummary(entry);
    for (const k of SKILLS) if (bands[k] !== null && bands[k] < IMPROVE_BELOW) n++;
  }
  return n;
}

// status: "all" | "todo" (nothing done in the chosen skills) | "improve" (any chosen skill below 6.5).
// skill: null (every skill) or one of L/R/W/S.
export function matchesFilter(entry, { status = "all", skill = null } = {}) {
  if (status === "all") return true;
  const { bands } = testSummary(entry);
  const chosen = skill ? [skill] : SKILLS;
  const values = chosen.map((k) => bands[k]).filter((v) => v !== null);
  if (status === "todo") return values.length === 0;
  if (status === "improve") return values.some((v) => v < IMPROVE_BELOW);
  return true;
}
