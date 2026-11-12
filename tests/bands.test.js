import test from "node:test";
import assert from "node:assert/strict";
import { rawToBand, roundBand, overallBand, writingEstimate, bandLevel, isBelowTable, BELOW_TABLE_BAND } from "../js/services/bands.js";

// Ranges copied from spec 6.1: [band, minRaw, maxRaw]
const LISTENING = [
  [9, 39, 40], [8.5, 37, 38], [8, 35, 36], [7.5, 32, 34], [7, 30, 31], [6.5, 26, 29], [6, 23, 25],
  [5.5, 18, 22], [5, 16, 17], [4.5, 13, 15], [4, 10, 12], [3.5, 8, 9], [3, 6, 7], [2.5, 4, 5],
];
const READING = [
  [9, 39, 40], [8.5, 37, 38], [8, 35, 36], [7.5, 33, 34], [7, 30, 32], [6.5, 27, 29], [6, 23, 26],
  [5.5, 19, 22], [5, 15, 18], [4.5, 13, 14], [4, 10, 12], [3.5, 8, 9], [3, 6, 7], [2.5, 4, 5],
];

for (const [name, skill, table] of [["Listening", "L", LISTENING], ["Reading", "R", READING]]) {
  test(`${name}: both ends of every band range`, () => {
    for (const [band, lo, hi] of table) {
      assert.equal(rawToBand(skill, lo), band, `${name} ${lo} -> ${band}`);
      assert.equal(rawToBand(skill, hi), band, `${name} ${hi} -> ${band}`);
    }
  });

  test(`${name}: every raw score 4-40 is covered, and 0-3 is below the table`, () => {
    for (let raw = 4; raw <= 40; raw++) {
      const expected = table.find(([, lo, hi]) => raw >= lo && raw <= hi)?.[0];
      assert.notEqual(expected, undefined, `table has a gap at ${raw}`);
      assert.equal(rawToBand(skill, raw), expected);
    }
    for (let raw = 0; raw <= 3; raw++) {
      assert.equal(rawToBand(skill, raw), BELOW_TABLE_BAND);
      assert.equal(isBelowTable(raw), true);
    }
    assert.equal(isBelowTable(4), false);
  });
}

test("examples from the brief", () => {
  assert.equal(rawToBand("R", 31), 7.0);
  assert.equal(rawToBand("R", 33), 7.5);
  assert.equal(rawToBand("L", 32), 7.5);
  assert.equal(rawToBand("L", 30), 7.0);
  assert.equal(rawToBand("R", 32), 7.0); // differs from Listening (7.5 starts at 32)
});

test("rawToBand rejects bad input", () => {
  assert.throws(() => rawToBand("R", 41), RangeError);
  assert.throws(() => rawToBand("R", -1), RangeError);
  assert.throws(() => rawToBand("R", 30.5), RangeError);
  assert.throws(() => rawToBand("R", NaN), RangeError);
  assert.throws(() => rawToBand("W", 30), RangeError);
});

test("roundBand follows rule 6.1", () => {
  const cases = [[6.25, 6.5], [6.75, 7.0], [6.125, 6.0], [6.0, 6.0], [6.24, 6.0], [6.5, 6.5], [6.74, 6.5], [5.875, 6.0], [6.375, 6.5], [6.625, 6.5], [8.875, 9.0]];
  for (const [avg, expected] of cases) assert.equal(roundBand(avg), expected, `${avg} -> ${expected}`);
});

test("overallBand: final with 4 skills, estimate with 2-3, nothing with fewer", () => {
  assert.deepEqual(overallBand({ L: 6.5, R: 7, W: 6, S: 6 }), { value: 6.5, count: 4, estimated: false }); // 6.375
  assert.deepEqual(overallBand({ L: 7.5, R: 7, W: 6 }), { value: 7.0, count: 3, estimated: true }); // 6.833
  assert.deepEqual(overallBand({ L: 7, R: 6, W: null, S: null }), { value: 6.5, count: 2, estimated: true });
  assert.equal(overallBand({ L: 7 }).value, null);
  assert.equal(overallBand({}).value, null);
});

test("writingEstimate = (T1 + 2*T2)/3 rounded by rule 6.1; one task is marked", () => {
  assert.deepEqual(writingEstimate(6.5, 6), { value: 6.0, marked: false }); // 6.167
  assert.deepEqual(writingEstimate(6, 7), { value: 6.5, marked: false }); // 6.667
  assert.deepEqual(writingEstimate(7, 7), { value: 7.0, marked: false });
  assert.deepEqual(writingEstimate(5.5, 6.5), { value: 6.0, marked: false }); // 6.167
  assert.deepEqual(writingEstimate(6.5, null), { value: 6.5, marked: true, only: 1 });
  assert.deepEqual(writingEstimate(undefined, 6), { value: 6, marked: true, only: 2 });
  assert.equal(writingEstimate(null, null), null);
});

test("bandLevel buckets", () => {
  assert.equal(bandLevel(null), "empty");
  assert.equal(bandLevel(5.5), "low");
  assert.equal(bandLevel(5.99), "low");
  assert.equal(bandLevel(6.0), "mid");
  assert.equal(bandLevel(6.5), "mid");
  assert.equal(bandLevel(7.0), "high");
  assert.equal(bandLevel(9), "high");
});
