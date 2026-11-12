import test from "node:test";
import assert from "node:assert/strict";
import { pickDefaultSource, RECENT_WINDOW_MS } from "../js/services/capture-source.js";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const last = (msAgo, extra = {}) => ({ source: { book: 15, test: 1, skill: "R", part: 2, ...extra }, at: NOW - msAgo });
const next = { book: 10, test: 1 };

test("the open panel wins over everything", () => {
  assert.deepEqual(pickDefaultSource({ panel: { book: 12, test: 3 }, last: last(1000), next, now: NOW }), { book: 12, test: 3 });
});

test("no panel: the previous save within 3 hours is used (with its skill and part)", () => {
  assert.deepEqual(pickDefaultSource({ last: last(60 * 60 * 1000), next, now: NOW }), { book: 15, test: 1, skill: "R", part: 2 });
});

test("exactly 3 hours is still recent; one millisecond more is not", () => {
  assert.equal(pickDefaultSource({ last: last(RECENT_WINDOW_MS), next, now: NOW }).book, 15);
  assert.deepEqual(pickDefaultSource({ last: last(RECENT_WINDOW_MS + 1), next, now: NOW }), { book: 10, test: 1 });
});

test("older than 3 hours: the next test", () => {
  assert.deepEqual(pickDefaultSource({ last: last(5 * 60 * 60 * 1000), next, now: NOW }), { book: 10, test: 1 });
});

test("no previous save: the next test; nothing at all: null", () => {
  assert.deepEqual(pickDefaultSource({ next, now: NOW }), { book: 10, test: 1 });
  assert.equal(pickDefaultSource({ now: NOW }), null);
});

test("a save with no test, or a timestamp in the future, is ignored", () => {
  assert.deepEqual(pickDefaultSource({ last: { source: null, at: NOW - 1000 }, next, now: NOW }), { book: 10, test: 1 });
  assert.deepEqual(pickDefaultSource({ last: { source: { book: 15, test: 1 }, at: NOW + 5000 }, next, now: NOW }), { book: 10, test: 1 });
});

test("the result is a copy: changing it does not change the saved source", () => {
  const l = last(1000);
  pickDefaultSource({ last: l, now: NOW }).book = 99;
  assert.equal(l.source.book, 15);
});
