// Split between the exam pane and the answer sheet on the practice screen (two columns, >= 1024px).
// Pure helpers + a tiny localStorage reader/writer. The ratio is a per-device convenience: it never goes into
// IndexedDB, the backup or the Drive sync.
export const SPLIT_MIN = 25;
export const SPLIT_MAX = 75;
export const SPLIT_DEFAULT = 55.5; // same as the old 1.25fr / 1fr
export const SPLIT_STEP = 5;
export const SPLIT_KEY = "elh.run.split";

export function clampSplit(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return SPLIT_DEFAULT;
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Math.round(n * 10) / 10));
}

// dir: -1 (exam pane smaller) or +1 (bigger)
export function stepSplit(p, dir) {
  return clampSplit(p + (dir < 0 ? -SPLIT_STEP : SPLIT_STEP));
}

// Percent of the exam pane for a pointer at clientX inside a box starting at `left` with the given `width`.
export function splitFromPointer(clientX, left, width) {
  if (!(width > 0)) return SPLIT_DEFAULT;
  return clampSplit(((clientX - left) / width) * 100);
}

export function loadSplit(storage) {
  try {
    const raw = storage?.getItem(SPLIT_KEY);
    return raw == null ? SPLIT_DEFAULT : clampSplit(raw);
  } catch {
    return SPLIT_DEFAULT;
  }
}

export function saveSplit(storage, p) {
  try {
    if (p === SPLIT_DEFAULT) storage?.removeItem(SPLIT_KEY);
    else storage?.setItem(SPLIT_KEY, String(clampSplit(p)));
  } catch { /* storage may be blocked: the split just is not remembered */ }
}
