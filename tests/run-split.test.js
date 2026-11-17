import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SPLIT_DEFAULT, SPLIT_MIN, SPLIT_MAX, SPLIT_KEY, clampSplit, stepSplit, splitFromPointer, loadSplit, saveSplit,
} from "../js/services/run-split.js";
import { nextZoom, ZOOMS } from "../js/components/pdf-viewer.js";
import { isAppleTouch } from "../js/services/recorder.js";

const fakeStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test("clampSplit keeps each side at 25% or more", () => {
  assert.equal(clampSplit(10), SPLIT_MIN);
  assert.equal(clampSplit(90), SPLIT_MAX);
  assert.equal(clampSplit(40.04), 40);
  assert.equal(clampSplit("abc"), SPLIT_DEFAULT);
  assert.equal(clampSplit(undefined), SPLIT_DEFAULT);
});

test("stepSplit moves by 5% and stops at the limits", () => {
  assert.equal(stepSplit(55, 1), 60);
  assert.equal(stepSplit(55, -1), 50);
  assert.equal(stepSplit(SPLIT_MAX, 1), SPLIT_MAX);
  assert.equal(stepSplit(27, -1), SPLIT_MIN);
});

test("splitFromPointer turns a pointer position into a percent inside the box", () => {
  assert.equal(splitFromPointer(500, 100, 1000), 40);
  assert.equal(splitFromPointer(0, 100, 1000), SPLIT_MIN);
  assert.equal(splitFromPointer(5000, 100, 1000), SPLIT_MAX);
  assert.equal(splitFromPointer(500, 100, 0), SPLIT_DEFAULT);
});

test("the ratio is saved and read from localStorage, a blocked storage falls back to the default", () => {
  const st = fakeStorage();
  assert.equal(loadSplit(st), SPLIT_DEFAULT);
  saveSplit(st, 40);
  assert.equal(st.getItem(SPLIT_KEY), "40");
  assert.equal(loadSplit(st), 40);
  saveSplit(st, SPLIT_DEFAULT); // the default is not stored
  assert.equal(st.getItem(SPLIT_KEY), null);
  st.setItem(SPLIT_KEY, "junk");
  assert.equal(loadSplit(st), SPLIT_DEFAULT);
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(loadSplit(blocked), SPLIT_DEFAULT);
  assert.doesNotThrow(() => saveSplit(blocked, 30));
  assert.equal(loadSplit(null), SPLIT_DEFAULT);
});

test("nextZoom walks the zoom steps and stops at both ends", () => {
  assert.equal(nextZoom(1, 1), 1.25);
  assert.equal(nextZoom(1, -1), 0.75);
  assert.equal(nextZoom(ZOOMS[0], -1), ZOOMS[0]);
  assert.equal(nextZoom(ZOOMS.at(-1), 1), ZOOMS.at(-1));
});

test("an iPad that says it is a Mac counts as an Apple touch device, a real Mac does not", () => {
  assert.equal(isAppleTouch({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 5 }), true);
  assert.equal(isAppleTouch({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 0 }), false);
  assert.equal(isAppleTouch({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", platform: "iPhone", maxTouchPoints: 5 }), true);
  assert.equal(isAppleTouch({ userAgent: "Mozilla/5.0 (Windows NT 10.0)", platform: "Win32", maxTouchPoints: 10 }), false);
});
