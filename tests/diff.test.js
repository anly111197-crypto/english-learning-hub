import test from "node:test";
import assert from "node:assert/strict";
import { diffWords } from "../js/services/diff.js";

const changed = (tokens) => tokens.filter((t) => t.changed).map((t) => t.text);

test("an extra word: only that word is marked, in the wrong sentence", () => {
  const d = diffWords("the technology has changed our lives", "technology has changed our lives");
  assert.deepEqual(changed(d.wrong), ["the"]);
  assert.deepEqual(changed(d.right), []);
});

test("a replaced word is marked on both sides", () => {
  const d = diffWords("I look forward to hear from you", "I look forward to hearing from you");
  assert.deepEqual(changed(d.wrong), ["hear"]);
  assert.deepEqual(changed(d.right), ["hearing"]);
});

test("a missing word is marked only in the corrected sentence", () => {
  const d = diffWords("She is student", "She is a student");
  assert.deepEqual(changed(d.wrong), []);
  assert.deepEqual(changed(d.right), ["a"]);
});

test("punctuation next to a word does not count as a change, capital letters do", () => {
  assert.deepEqual(changed(diffWords("It works well", "It works well.").wrong), []);
  const d = diffWords("i agree.", "I agree.");
  assert.deepEqual(changed(d.wrong), ["i"]);
  assert.deepEqual(changed(d.right), ["I"]);
});

test("several separate changes", () => {
  const d = diffWords("Scientists make a research on renewables", "Scientists do research on renewables");
  assert.deepEqual(changed(d.wrong), ["make", "a"]);
  assert.deepEqual(changed(d.right), ["do"]);
});

test("identical sentences and an empty correction mark nothing", () => {
  assert.deepEqual(changed(diffWords("same text", "same text").wrong), []);
  const none = diffWords("no correction yet", "");
  assert.deepEqual(changed(none.wrong), []);
  assert.deepEqual(none.right, []);
  assert.deepEqual(diffWords("", ""), { wrong: [], right: [] });
});

test("the original words are kept in order", () => {
  const d = diffWords("a  b   c", "a b c");
  assert.deepEqual(d.wrong.map((t) => t.text), ["a", "b", "c"]);
});
