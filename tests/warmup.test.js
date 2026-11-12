import test from "node:test";
import assert from "node:assert/strict";
import {
  STEP_LIMITS_MS, remainingMs, formatClock, afterQuestion, pickErrorQueue, applyErrorResult, shouldSuggestFixed,
  summarizeSession, sessionWarmup,
} from "../js/services/warmup.js";
import { pickWarmupErrors } from "../js/services/errors.js";

const err = (id, extra = {}) => ({ id, original: `wrong ${id}`, corrected: `right ${id}`, status: "new", occurrences: 1, lastSeen: "2026-11-10", warmupStreak: 0, deleted: false, ...extra });

test("step limits: 10 minutes for vocabulary, 5 for grammar", () => {
  assert.equal(STEP_LIMITS_MS[1], 600000);
  assert.equal(STEP_LIMITS_MS[2], 300000);
});

test("clock: remaining time never goes below zero; mm:ss rounds seconds up", () => {
  assert.equal(remainingMs(1000, 1000, 600000), 600000);
  assert.equal(remainingMs(1000, 61000, 600000), 540000);
  assert.equal(remainingMs(1000, 999999, 600000), 0);
  assert.equal(formatClock(600000), "10:00");
  assert.equal(formatClock(61000), "01:01");
  assert.equal(formatClock(999), "00:01");
  assert.equal(formatClock(0), "00:00");
  assert.equal(formatClock(300000), "05:00");
});

test("afterQuestion: finish the current question first; time up or no more cards moves on", () => {
  assert.equal(afterQuestion({ step: 1, timeUp: false, hasMore: true }), "next");
  assert.equal(afterQuestion({ step: 1, timeUp: true, hasMore: true }), "step2");
  assert.equal(afterQuestion({ step: 1, timeUp: false, hasMore: false }), "step2");
  assert.equal(afterQuestion({ step: 2, timeUp: false, hasMore: true }), "next");
  assert.equal(afterQuestion({ step: 2, timeUp: true, hasMore: true }), "summary");
  assert.equal(afterQuestion({ step: 2, timeUp: false, hasMore: false }), "summary");
});

test("pickErrorQueue: 5 errors, not fixed, with a correct sentence", () => {
  const errors = [
    err("a", { occurrences: 5 }), err("b", { occurrences: 4, corrected: "" }), err("c", { occurrences: 9, status: "fixed" }),
    err("d", { occurrences: 3 }), err("e", { occurrences: 2 }), err("f", { occurrences: 2, lastSeen: "2026-11-11" }),
    err("g", { occurrences: 1 }), err("h", { occurrences: 1 }), err("i", { occurrences: 7, deleted: true }), err("j", { occurrences: 6, corrected: "   " }),
  ];
  assert.deepEqual(pickErrorQueue(errors).map((e) => e.id), ["a", "d", "f", "e", "g"]);
  assert.deepEqual(pickErrorQueue(errors, 2).map((e) => e.id), ["a", "d"]);
});

test("pickWarmupErrors without the option still includes errors that have no correct sentence", () => {
  const errors = [err("a", { corrected: "" }), err("b")];
  assert.equal(pickWarmupErrors(errors).length, 2);
  assert.equal(pickWarmupErrors(errors, 5, { requireCorrection: true }).length, 1);
});

test("applyErrorResult: right -> streak + 1 and new becomes practicing", () => {
  assert.deepEqual(applyErrorResult(err("a", { warmupStreak: 0, status: "new" }), true), { warmupStreak: 1, status: "practicing" });
  assert.deepEqual(applyErrorResult(err("a", { warmupStreak: 2, status: "practicing" }), true), { warmupStreak: 3, status: "practicing" });
  assert.deepEqual(applyErrorResult(err("a", { warmupStreak: 1, status: "recurring" }), true), { warmupStreak: 2, status: "recurring" });
});

test("applyErrorResult: wrong -> streak 0, status unchanged", () => {
  assert.deepEqual(applyErrorResult(err("a", { warmupStreak: 2, status: "practicing" }), false), { warmupStreak: 0, status: "practicing" });
  assert.deepEqual(applyErrorResult(err("a", { warmupStreak: 1, status: "new" }), false), { warmupStreak: 0, status: "new" });
  assert.deepEqual(applyErrorResult({ status: "new" }, true), { warmupStreak: 1, status: "practicing" }); // no streak stored yet
});

test("shouldSuggestFixed: 3 or more in a row and not fixed yet", () => {
  assert.equal(shouldSuggestFixed(err("a", { warmupStreak: 3 })), true);
  assert.equal(shouldSuggestFixed(err("a", { warmupStreak: 5, status: "practicing" })), true);
  assert.equal(shouldSuggestFixed(err("a", { warmupStreak: 2 })), false);
  assert.equal(shouldSuggestFixed(err("a", { warmupStreak: 4, status: "fixed" })), false);
  assert.equal(shouldSuggestFixed({}), false);
});

test("summarizeSession: remembered = correct only; near and skipped counted apart; wrong ids listed", () => {
  const vocab = [
    { id: "v1", outcome: "correct" }, { id: "v2", outcome: "wrong" }, { id: "v3", outcome: "near" },
    { id: "v4", outcome: "skipped" }, { id: "v5", outcome: "correct" }, { id: "v6", outcome: "wrong" },
  ];
  const errors = [{ id: "e1", correct: true }, { id: "e2", correct: false }, { id: "e3", skipped: true }, { id: "e4", correct: true }];
  const s = summarizeSession(vocab, errors);
  assert.equal(s.vocabTotal, 5);
  assert.equal(s.vocabCorrect, 2);
  assert.equal(s.vocabNear, 1);
  assert.equal(s.vocabSkipped, 1);
  assert.deepEqual(s.wrongVocabIds, ["v2", "v6"]);
  assert.equal(s.errorsTotal, 3);
  assert.equal(s.errorsCorrect, 2);
  assert.equal(s.errorsSkipped, 1);
  assert.deepEqual(s.wrongErrorIds, ["e2"]);
});

test("sessionWarmup has exactly the fields of spec 7.1", () => {
  const s = summarizeSession([{ id: "v1", outcome: "wrong" }], [{ id: "e1", correct: true }]);
  assert.deepEqual(sessionWarmup(s), { vocabTotal: 1, vocabCorrect: 0, errorsTotal: 1, errorsCorrect: 1, wrongVocabIds: ["v1"] });
  assert.deepEqual(sessionWarmup(summarizeSession([], [])), { vocabTotal: 0, vocabCorrect: 0, errorsTotal: 0, errorsCorrect: 0, wrongVocabIds: [] });
});
