import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeText, foldForSearch, lemmaPosKey, matchVocab, addContext, contextKey, unionStrings, findErrorDuplicate,
} from "../js/services/dedupe.js";

const card = (id, lemma, pos = "") => ({ id, word: lemma, lemma, pos, contexts: [] });
const src = (book, testNo, skill, part) => ({ book, test: testNo, skill, part });

test("normalizeText and lemmaPosKey ignore case and extra spaces", () => {
  assert.equal(normalizeText("  Make   a  Decision "), "make a decision");
  assert.equal(lemmaPosKey(" Mitigate ", "Verb"), "mitigate|verb");
  assert.equal(lemmaPosKey("mitigate", ""), "mitigate|");
});

test("foldForSearch drops Vietnamese diacritics", () => {
  assert.equal(foldForSearch("Đô thị hoá"), "do thi hoa");
  assert.equal(foldForSearch("Giảm NHẸ"), "giam nhe");
});

test("matchVocab: no card with this lemma", () => {
  assert.deepEqual(matchVocab([card("1", "mitigate", "verb")], { lemma: "alleviate" }), { kind: "none", matches: [] });
  assert.equal(matchVocab([], { lemma: "x" }).kind, "none");
});

test("matchVocab: same lemma, empty pos, one card (any pos) -> single, add to the old card", () => {
  const vocab = [card("1", "mitigate", "verb")];
  const m = matchVocab(vocab, { lemma: " Mitigate " });
  assert.equal(m.kind, "single");
  assert.equal(m.matches[0].id, "1");
});

test("matchVocab: an existing card with empty pos is an exact match", () => {
  const vocab = [card("1", "record", ""), card("2", "record", "noun")];
  const m = matchVocab(vocab, { lemma: "record" });
  assert.equal(m.kind, "exact");
  assert.equal(m.matches[0].id, "1");
});

test("matchVocab: same lemma, different pos, several cards -> multiple (ask the learner)", () => {
  const vocab = [card("1", "record", "noun"), card("2", "record", "verb")];
  const m = matchVocab(vocab, { lemma: "record" });
  assert.equal(m.kind, "multiple");
  assert.deepEqual(m.matches.map((c) => c.id), ["1", "2"]);
});

test("matchVocab: a given pos only matches the same pos", () => {
  const vocab = [card("1", "record", "noun")];
  assert.equal(matchVocab(vocab, { lemma: "record", pos: "noun" }).kind, "exact");
  assert.equal(matchVocab(vocab, { lemma: "record", pos: "verb" }).kind, "none");
});

test("matchVocab uses word when a card has no lemma", () => {
  const m = matchVocab([{ id: "1", word: "Curb", pos: "verb", contexts: [] }], { lemma: "curb" });
  assert.equal(m.kind, "single");
});

test("addContext: a new sentence is added; the input array is untouched", () => {
  const before = [];
  const ctx = { sentence: "We must mitigate risk.", source: src(15, 1, "R", 2), date: "2026-11-12" };
  const out = addContext(before, ctx);
  assert.equal(out.added, true);
  assert.equal(out.contexts.length, 1);
  assert.equal(before.length, 0);
});

test("addContext: the same sentence from the same place is not added twice", () => {
  const first = { sentence: "We must mitigate risk.", source: src(15, 1, "R", 2) };
  const again = { sentence: "  we must MITIGATE   risk. ", source: src(15, 1, "R", 2), date: "2026-11-13" };
  const out = addContext([first], again);
  assert.equal(out.added, false);
  assert.equal(out.contexts.length, 1);
});

test("addContext: the same sentence from another place is a new context; an empty sentence is ignored", () => {
  const first = { sentence: "We must mitigate risk.", source: src(15, 1, "R", 2) };
  assert.equal(addContext([first], { sentence: "We must mitigate risk.", source: src(16, 2, "R", 1) }).added, true);
  assert.equal(addContext([first], { sentence: "   ", source: src(15, 1, "R", 2) }).added, false);
  assert.equal(addContext(undefined, { sentence: "x", source: null }).added, true);
  assert.notEqual(contextKey({ sentence: "a", source: null }), contextKey({ sentence: "a", source: src(15, 1, "R", 2) }));
});

test("unionStrings: no duplicates by case or spacing, keeps first spelling", () => {
  assert.deepEqual(unionStrings(["Make a decision", "reach a goal"], ["make  a decision", "take action", " "]),
    ["Make a decision", "reach a goal", "take action"]);
});

test("findErrorDuplicate: same wrong sentence regardless of case and spaces", () => {
  const errors = [{ id: "e1", original: "The technology has changed" }, { id: "e2", original: "Other" }];
  assert.equal(findErrorDuplicate(errors, "  the technology   has changed ").id, "e1");
  assert.equal(findErrorDuplicate(errors, "something else"), undefined);
  assert.equal(findErrorDuplicate(errors, "   "), undefined);
});
