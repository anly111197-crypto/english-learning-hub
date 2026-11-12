import test from "node:test";
import assert from "node:assert/strict";
import { nextTest } from "../js/services/next-test.js";

let n = 0;
const att = (book, testNo, skill, date = "2026-10-01", extra = {}) => ({
  id: `a${++n}`, book, test: testNo, skill, band: 6.5, date, updatedAt: `${date}T00:00:00Z`, deleted: false, ...extra,
});
const both = (book, testNo, date) => [att(book, testNo, "L", date), att(book, testNo, "R", date)];
const pinnedTest = (book, testNo, extra = {}) => ({ key: `${book}-${testNo}`, book, test: testNo, pinned: true, updatedAt: "2026-10-01T00:00:00Z", deleted: false, ...extra });

test("no attempts: start at the first book in the order, Test 1", () => {
  assert.deepEqual(nextTest({}), { book: 10, test: 1, reason: "start" });
  assert.deepEqual(nextTest({ bookOrder: [15, 16] }), { book: 15, test: 1, reason: "start" });
});

test("a pinned test wins over everything", () => {
  const attempts = [...both(15, 1, "2026-10-05")];
  assert.deepEqual(nextTest({ attempts, tests: [pinnedTest(12, 4)] }), { book: 12, test: 4, reason: "pinned" });
});

test("a pinned test stays chosen even when it already has L and R", () => {
  const attempts = [...both(15, 1, "2026-10-05")];
  assert.equal(nextTest({ attempts, tests: [pinnedTest(15, 1)] }).reason, "pinned");
});

test("deleted pin is ignored; the most recently updated pin wins if there are several", () => {
  assert.equal(nextTest({ tests: [pinnedTest(12, 4, { deleted: true })] }).reason, "start");
  const tests = [pinnedTest(11, 1), pinnedTest(13, 2, { updatedAt: "2026-10-09T00:00:00Z" })];
  assert.deepEqual(nextTest({ tests }), { book: 13, test: 2, reason: "pinned" });
});

test("continue the book of the latest attempt: smallest test missing L or R", () => {
  const attempts = [...both(15, 1, "2026-10-01"), att(15, 2, "L", "2026-10-02")];
  assert.deepEqual(nextTest({ attempts }), { book: 15, test: 2, reason: "continue" });
});

test("a lower test with a missing skill is picked before a higher one", () => {
  const attempts = [att(15, 1, "L", "2026-10-01"), ...both(15, 2, "2026-10-02")];
  assert.deepEqual(nextTest({ attempts }), { book: 15, test: 1, reason: "continue" });
});

test("Writing and Speaking alone do not count as doing a test", () => {
  const attempts = [att(15, 1, "W", "2026-10-01", { task: 2 }), att(15, 1, "S", "2026-10-01")];
  assert.deepEqual(nextTest({ attempts }), { book: 15, test: 1, reason: "continue" });
});

test("latest attempt (by date) decides the book, not the highest book number", () => {
  const attempts = [...both(12, 1, "2026-09-01"), att(15, 1, "L", "2026-10-02"), att(12, 2, "R", "2026-08-01")];
  assert.deepEqual(nextTest({ attempts }), { book: 15, test: 1, reason: "continue" });
});

test("finished book moves on to the next book in the default order", () => {
  const attempts = [1, 2, 3, 4].flatMap((t) => both(15, t, "2026-10-0" + t));
  assert.deepEqual(nextTest({ attempts }), { book: 16, test: 1, reason: "next-book" });
});

test("finished book follows the learner's own order and skips finished books", () => {
  const attempts = [1, 2, 3, 4].flatMap((t) => [...both(15, t, "2026-10-0" + t), ...both(19, t, "2026-09-0" + t)]);
  assert.deepEqual(nextTest({ attempts, bookOrder: [15, 19, 12, 10] }), { book: 12, test: 1, reason: "next-book" });
});

test("order wraps around to an earlier unfinished book", () => {
  const attempts = [1, 2, 3, 4].flatMap((t) => both(19, t, "2026-10-0" + t));
  assert.deepEqual(nextTest({ attempts }), { book: 10, test: 1, reason: "next-book" });
});

test("everything done: null", () => {
  const attempts = [10, 11].flatMap((b) => [1, 2, 3, 4].flatMap((t) => both(b, t, "2026-10-01")));
  assert.equal(nextTest({ attempts, bookOrder: [10, 11] }), null);
});

test("deleted attempts are ignored", () => {
  const attempts = [att(15, 1, "L", "2026-10-01"), att(15, 1, "R", "2026-10-01", { deleted: true })];
  assert.deepEqual(nextTest({ attempts }), { book: 15, test: 1, reason: "continue" });
});
