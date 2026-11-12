// Which test should quick capture pre-fill? Pure function.
export const RECENT_WINDOW_MS = 3 * 60 * 60 * 1000; // 3 hours

// panel  { book, test } of the test panel that is open, or null
// last   { source: { book, test, skill?, part? }, at: ms } the previous save, or null
// next   { book, test } the "next practice session", or null
// 1. the open panel, 2. the previous save if it was at most 3 hours ago, 3. the next test.
export function pickDefaultSource({ panel = null, last = null, now = Date.now(), next = null } = {}) {
  if (panel) return { book: panel.book, test: panel.test };
  const age = last ? now - last.at : NaN;
  if (last?.source?.book && age >= 0 && age <= RECENT_WINDOW_MS) return { ...last.source };
  if (next) return { book: next.book, test: next.test };
  return null;
}
