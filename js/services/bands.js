// Band conversion and rounding (spec 6.1). Pure functions.

// [band, lowest raw score that reaches it], highest band first. Table is an estimate (spec 6.1).
const LISTENING_TABLE = [
  [9, 39], [8.5, 37], [8, 35], [7.5, 32], [7, 30], [6.5, 26], [6, 23],
  [5.5, 18], [5, 16], [4.5, 13], [4, 10], [3.5, 8], [3, 6], [2.5, 4],
];
const READING_TABLE = [
  [9, 39], [8.5, 37], [8, 35], [7.5, 33], [7, 30], [6.5, 27], [6, 23],
  [5.5, 19], [5, 15], [4.5, 13], [4, 10], [3.5, 8], [3, 6], [2.5, 4],
];

// The spec table stops at 2.5 (raw 4-5). Lower scores get this band and are flagged "below table".
export const BELOW_TABLE_BAND = 2.0;
export const LOWEST_TABLE_RAW = 4;

export const isBelowTable = (raw) => raw < LOWEST_TABLE_RAW;

// skill: "L" or "R" (Academic Reading). raw: integer 0-40.
export function rawToBand(skill, raw) {
  const table = skill === "L" ? LISTENING_TABLE : skill === "R" ? READING_TABLE : null;
  if (!table) throw new RangeError(`Chỉ quy đổi được Listening (L) và Reading (R), không phải "${skill}".`);
  if (!Number.isInteger(raw) || raw < 0 || raw > 40) throw new RangeError("Số câu đúng phải là số nguyên từ 0 đến 40.");
  for (const [band, minRaw] of table) if (raw >= minRaw) return band;
  return BELOW_TABLE_BAND;
}

// Rule 6.1: fraction < .25 -> down to whole; .25 to < .75 -> .5; >= .75 -> up to next whole.
export function roundBand(average) {
  const whole = Math.floor(average + 1e-9);
  const frac = Math.round((average - whole) * 1e6) / 1e6;
  if (frac < 0.25) return whole;
  if (frac < 0.75) return whole + 0.5;
  return whole + 1;
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// bands: { L, R, W, S } (missing or null = not done).
// Needs at least 2 skills. With 4 it is final; with 2-3 it is an estimate ("Ước tính (n/4)").
export function overallBand(bands) {
  const values = ["L", "R", "W", "S"].map((k) => bands[k]).filter(isNum);
  if (values.length < 2) return { value: null, count: values.length, estimated: true };
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return { value: roundBand(avg), count: values.length, estimated: values.length < 4 };
}

// Estimated Writing band = (Task 1 + 2 x Task 2) / 3, rounded by rule 6.1. This is an estimate,
// not the official formula. With only one task, that task's band is shown and `marked` is true ("*").
export function writingEstimate(task1, task2) {
  const has1 = isNum(task1);
  const has2 = isNum(task2);
  if (has1 && has2) return { value: roundBand((task1 + 2 * task2) / 3), marked: false };
  if (has2) return { value: task2, marked: true, only: 2 };
  if (has1) return { value: task1, marked: true, only: 1 };
  return null;
}

// Color level used by the matrix: empty / low (<6.0) / mid (6.0-6.5) / high (>=7.0).
export function bandLevel(band) {
  if (!isNum(band)) return "empty";
  if (band < 6) return "low";
  if (band < 7) return "mid";
  return "high";
}

export const formatBand = (band) => (isNum(band) ? band.toFixed(1) : "–");
