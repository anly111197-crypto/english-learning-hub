import test from "node:test";
import assert from "node:assert/strict";
import { BOX_INTERVAL_DAYS, addDays, nextReviewDate, isDue, isoDate } from "../js/services/leitner.js";

test("intervals follow spec 6.3: 1, 3, 7, 14, 30 days", () => {
  assert.deepEqual(BOX_INTERVAL_DAYS, { 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 });
  assert.equal(nextReviewDate(1, "2026-11-12"), "2026-11-13");
  assert.equal(nextReviewDate(2, "2026-11-12"), "2026-11-15");
  assert.equal(nextReviewDate(3, "2026-11-12"), "2026-11-19");
  assert.equal(nextReviewDate(4, "2026-11-12"), "2026-11-26");
  assert.equal(nextReviewDate(5, "2026-11-12"), "2026-12-12");
});

test("addDays crosses month and year ends and leap days", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2027-02-28", 1), "2027-03-01");
  assert.equal(addDays("2026-01-31", 30), "2026-03-02");
});

test("nextReviewDate rejects a box outside 1-5", () => {
  assert.throws(() => nextReviewDate(0), RangeError);
  assert.throws(() => nextReviewDate(6), RangeError);
});

test("isDue: today or earlier is due, tomorrow is not, no date is not", () => {
  assert.equal(isDue({ nextReview: "2026-11-12" }, "2026-11-12"), true);
  assert.equal(isDue({ nextReview: "2026-11-01" }, "2026-11-12"), true);
  assert.equal(isDue({ nextReview: "2026-11-13" }, "2026-11-12"), false);
  assert.equal(isDue({}, "2026-11-12"), false);
});

test("isoDate formats local dates with zero padding", () => {
  assert.equal(isoDate(new Date(2026, 0, 5)), "2026-01-05");
});
