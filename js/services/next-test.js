// "Next practice session" (spec 6.2). Pure function.
import { BOOKS, TESTS, indexAttempts, isTestDone, testKey } from "./progress.js";

export const DEFAULT_BOOK_ORDER = BOOKS;

const ts = (s) => {
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
};

// The most recent attempt: latest date, then latest update. Returns null when there is none.
export function latestAttempt(attempts) {
  return [...attempts.filter((a) => !a.deleted)]
    .sort((a, b) => ts(b.date) - ts(a.date) || ts(b.updatedAt) - ts(a.updatedAt))[0] ?? null;
}

// Returns { book, test, reason } or null when every test in the order is done.
// reason: "pinned" | "continue" (same book as the latest attempt) | "next-book" | "start" (no attempts yet).
//  1. A pinned test wins.
//  2. Otherwise the smallest test of the latest attempt's book that still lacks L or R.
//  3. Otherwise the next book in the learner's order (wrapping around) that has such a test.
export function nextTest({ attempts = [], tests = [], bookOrder = DEFAULT_BOOK_ORDER } = {}) {
  const pinned = tests
    .filter((t) => t.pinned && !t.deleted)
    .sort((a, b) => ts(b.updatedAt) - ts(a.updatedAt))[0];
  if (pinned) return { book: pinned.book, test: pinned.test, reason: "pinned" };

  const live = attempts.filter((a) => !a.deleted);
  const index = indexAttempts(live);
  const firstMissing = (book) => TESTS.find((t) => !isTestDone(index.get(testKey(book, t))));

  if (live.length === 0) {
    for (const book of bookOrder) {
      const test = firstMissing(book);
      if (test) return { book, test, reason: "start" };
    }
    return null;
  }

  const latest = latestAttempt(live);
  const sameBook = firstMissing(latest.book);
  if (sameBook) return { book: latest.book, test: sameBook, reason: "continue" };

  const pos = bookOrder.indexOf(latest.book);
  for (let i = 1; i <= bookOrder.length; i++) {
    const book = bookOrder[(pos + i + bookOrder.length) % bookOrder.length];
    if (book === latest.book) continue;
    const test = firstMissing(book);
    if (test) return { book, test, reason: "next-book" };
  }
  return null;
}
