import test from "node:test";
import assert from "node:assert/strict";
import {
  indexAttempts, testSummary, isTestDone, booksDoneCount, totalDone, averageSummary, countNeedsImprovement, matchesFilter,
} from "../js/services/progress.js";

let n = 0;
const att = (book, testNo, skill, band, extra = {}) => ({
  id: `a${++n}`, book, test: testNo, skill, band, date: "2026-10-01", updatedAt: "2026-10-01T00:00:00Z", deleted: false, ...extra,
});

const attempts = [
  att(15, 1, "L", 7.5), att(15, 1, "R", 7.0), att(15, 1, "W", 6.5, { task: 1 }), att(15, 1, "W", 6.0, { task: 2 }),
  att(15, 2, "L", 6.0), att(15, 2, "R", 5.5),
  att(16, 1, "L", 7.0),
];
const index = indexAttempts(attempts);

test("indexAttempts groups by book-test and keeps Writing tasks apart", () => {
  const e = index.get("15-1");
  assert.equal(e.L.band, 7.5);
  assert.equal(e.W1.band, 6.5);
  assert.equal(e.W2.band, 6.0);
  assert.equal(index.has("15-3"), false);
});

test("indexAttempts ignores deleted records and keeps the newest duplicate", () => {
  const idx = indexAttempts([
    att(10, 1, "L", 5.0, { deleted: true }),
    att(10, 2, "L", 5.0, { updatedAt: "2026-10-01T00:00:00Z" }),
    att(10, 2, "L", 6.5, { updatedAt: "2026-10-02T00:00:00Z" }),
  ]);
  assert.equal(idx.has("10-1"), false);
  assert.equal(idx.get("10-2").L.band, 6.5);
});

test("testSummary: Writing estimate, skills done and overall estimate", () => {
  const s = testSummary(index.get("15-1"));
  assert.deepEqual(s.bands, { L: 7.5, R: 7.0, W: 6.0, S: null }); // (6.5 + 12)/3 = 6.167 -> 6.0
  assert.equal(s.skillsDone, 3);
  assert.equal(s.overall.count, 3);
  assert.equal(s.overall.estimated, true);
  assert.equal(s.overall.value, 7.0); // (7.5 + 7 + 6)/3 = 6.833 -> 7.0
});

test("a test is done only with both L and R", () => {
  assert.equal(isTestDone(index.get("15-1")), true);
  assert.equal(isTestDone(index.get("16-1")), false);
  assert.equal(isTestDone(undefined), false);
  assert.equal(booksDoneCount(index, 15), 2);
  assert.equal(totalDone(index), 2);
});

test("averageSummary: rounded per skill, overall estimate, weakest skill", () => {
  const a = averageSummary(index);
  assert.equal(a.rounded.L, 7.0); // (7.5 + 6 + 7)/3 = 6.833 -> 7.0
  assert.equal(a.rounded.R, 6.5); // (7 + 5.5)/2 = 6.25 -> 6.5
  assert.equal(a.rounded.W, 6.0);
  assert.equal(a.rounded.S, null);
  assert.equal(a.weakest, "W");
  assert.equal(a.weakestBand, 6.0);
  assert.equal(a.overall.count, 3);
});

test("averageSummary with a single skill has no weakest skill and no overall", () => {
  const a = averageSummary(indexAttempts([att(15, 1, "L", 7)]));
  assert.equal(a.weakest, null);
  assert.equal(a.overall.value, null);
});

test("countNeedsImprovement counts (test, skill) cells below 6.5", () => {
  // 15-1: W 6.0 ; 15-2: L 6.0, R 5.5 ; others >= 6.5 -> 3
  assert.equal(countNeedsImprovement(index), 3);
});

test("matchesFilter: all / todo / improve, with and without a skill", () => {
  const e1 = index.get("15-1");
  const e2 = index.get("15-2");
  assert.equal(matchesFilter(undefined, { status: "all" }), true);
  assert.equal(matchesFilter(undefined, { status: "todo" }), true);
  assert.equal(matchesFilter(e1, { status: "todo" }), false);
  assert.equal(matchesFilter(e1, { status: "todo", skill: "S" }), true); // no Speaking yet
  assert.equal(matchesFilter(e1, { status: "improve" }), true); // W 6.0
  assert.equal(matchesFilter(e1, { status: "improve", skill: "L" }), false);
  assert.equal(matchesFilter(e2, { status: "improve", skill: "R" }), true);
  assert.equal(matchesFilter(undefined, { status: "improve" }), false);
});
