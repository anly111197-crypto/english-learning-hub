import test from "node:test";
import assert from "node:assert/strict";
import {
  BOX_INTERVAL_DAYS, addDays, nextReviewDate, isDue, isoDate, recentCaptureDates, pickDueCards, levenshtein, matchGrade,
  wordForms, findBlank, kindForBox, hasMeaning, distractorPool, canUseKind, chooseKind, shuffle, buildQuestion,
  gradeAnswer, applyOutcome, outcomeMessage, MAX_DECK,
} from "../js/services/leitner.js";

const TODAY = "2026-11-12";

// small deterministic random numbers
const seeded = (seed = 7) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

let n = 0;
const card = (word, extra = {}) => ({
  id: `w${++n}`, word, lemma: word.toLowerCase(), pos: "", meaningVi: `nghĩa của ${word}`, box: 1, lapses: 0,
  nextReview: TODAY, contexts: [], collocations: [], synonyms: [], deleted: false, ...extra,
});
const occ = (itemId, date, extra = {}) => ({ id: `o${++n}`, itemType: "vocab", itemId, date, deleted: false, ...extra });

// ---- dates and boxes ----
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

// ---- choosing the cards ----
test("recentCaptureDates: the 3 latest days that have a vocab occurrence, deleted and error records ignored", () => {
  const occs = [
    occ("a", "2026-11-01"), occ("a", "2026-11-03"), occ("b", "2026-11-03"), occ("c", "2026-11-05"),
    occ("d", "2026-11-09"), occ("e", "2026-11-12", { deleted: true }), occ("f", "2026-11-12", { itemType: "error" }),
  ];
  assert.deepEqual([...recentCaptureDates(occs)].sort(), ["2026-11-03", "2026-11-05", "2026-11-09"]);
  assert.equal(recentCaptureDates([]).size, 0);
});

test("pickDueCards: only due, live cards (today counts, tomorrow does not)", () => {
  const vocab = [card("a"), card("b", { nextReview: "2026-11-13" }), card("c", { deleted: true }), card("d", { nextReview: "2026-10-01" }), card("e", { nextReview: undefined })];
  assert.deepEqual(pickDueCards(vocab, [], TODAY).map((w) => w.word).sort(), ["a", "d"]);
});

test("pickDueCards priority: words written in the last 3 capture days, then more lapses, then most overdue", () => {
  const recentFew = card("recentFew", { lapses: 0, nextReview: TODAY });
  const recentMore = card("recentMore", { lapses: 2, nextReview: TODAY });
  const oldManyLapses = card("oldManyLapses", { lapses: 5, nextReview: "2026-11-10" });
  const oldFewLapses = card("oldFewLapses", { lapses: 1, nextReview: "2026-11-01" });
  const oldSameLapsesLate = card("oldLate", { lapses: 1, nextReview: "2026-11-09" });
  const occs = [occ(recentFew.id, "2026-11-12"), occ(recentMore.id, "2026-11-11"), occ(oldManyLapses.id, "2026-10-01"), occ("x", "2026-11-08")];
  const order = pickDueCards([oldFewLapses, oldSameLapsesLate, recentFew, oldManyLapses, recentMore], occs, TODAY).map((w) => w.word);
  assert.deepEqual(order, ["recentMore", "recentFew", "oldManyLapses", "oldFewLapses", "oldLate"]);
});

test("pickDueCards: at most 20, ties broken by id, input untouched", () => {
  const vocab = Array.from({ length: 25 }, (_, i) => card(`w${i}`, { id: `id${String(i).padStart(2, "0")}` }));
  const reversed = [...vocab].reverse();
  const picked = pickDueCards(reversed, [], TODAY);
  assert.equal(picked.length, MAX_DECK);
  assert.equal(picked[0].id, "id00");
  assert.equal(picked[19].id, "id19");
  assert.equal(reversed[0].id, "id24");
  assert.equal(pickDueCards(vocab, [], TODAY, 5).length, 5);
});

// ---- matching typed answers ----
test("levenshtein", () => {
  assert.equal(levenshtein("kitten", "sitting"), 3);
  assert.equal(levenshtein("mitigate", "mitigat"), 1);
  assert.equal(levenshtein("", "abc"), 3);
  assert.equal(levenshtein("same", "same"), 0);
});

test("matchGrade: ignores case and extra spaces; one slip is near only for answers of 6+ letters", () => {
  assert.equal(matchGrade("  Mitigate ", ["mitigate"]), "correct");
  assert.equal(matchGrade("mitigate  the   impact", ["Mitigate the impact"]), "correct");
  assert.equal(matchGrade("mitigat", ["mitigate"]), "near"); // missing letter
  assert.equal(matchGrade("mitigote", ["mitigate"]), "near"); // wrong letter
  assert.equal(matchGrade("mitigatee", ["mitigate"]), "near"); // extra letter
  assert.equal(matchGrade("mitiage", ["mitigate"]), "wrong"); // two slips
  assert.equal(matchGrade("curbs", ["curb"]), "wrong"); // short word: no "near"
  assert.equal(matchGrade("curd", ["curb"]), "wrong");
  assert.equal(matchGrade("planet", ["planes"]), "near"); // exactly 6 letters
  assert.equal(matchGrade("plane", ["plana"]), "wrong"); // 5 letters
  assert.equal(matchGrade("", ["mitigate"]), "wrong");
  assert.equal(matchGrade("alleviate", ["mitigate", "alleviate"]), "correct");
});

test("wordForms: common inflections; a phrase stays as it is", () => {
  const m = wordForms("mitigate");
  for (const f of ["mitigate", "mitigates", "mitigated", "mitigating"]) assert.ok(m.includes(f), f);
  const s = wordForms("study");
  for (const f of ["studies", "studied", "studying"]) assert.ok(s.includes(f), f);
  const p = wordForms("stop");
  for (const f of ["stopped", "stopping"]) assert.ok(p.includes(f), f);
  assert.deepEqual(wordForms("make a decision"), ["make a decision"]);
  assert.deepEqual(wordForms("  "), []);
});

test("findBlank: finds the word or an inflection, whole words only, keeps the original text", () => {
  const forms = wordForms("mitigate");
  assert.deepEqual(findBlank("Trees mitigated the noise.", forms), { before: "Trees ", match: "mitigated", after: " the noise." });
  assert.deepEqual(findBlank("Mitigate risk early.", forms), { before: "", match: "Mitigate", after: " risk early." });
  assert.equal(findBlank("An article about art.", wordForms("art")).match, "art");
  assert.equal(findBlank("An article about it.", wordForms("art")), null); // "article" is not "art"
  assert.deepEqual(findBlank("We must make a decision now.", wordForms("make a decision")), { before: "We must ", match: "make a decision", after: " now." });
  assert.equal(findBlank("", forms), null);
});

// ---- which kind of exercise ----
test("kindForBox", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(kindForBox), ["flashcard", "flashcard", "choice", "fill", "type"]);
});

test("distractorPool: other live cards with a different, non-empty meaning (each meaning once)", () => {
  const w = card("w", { meaningVi: "một" });
  const pool = distractorPool(w, [w, card("a", { meaningVi: "hai" }), card("b", { meaningVi: "Hai " }), card("c", { meaningVi: "một" }), card("d", { meaningVi: "" }), card("e", { meaningVi: "ba", deleted: true })]);
  assert.deepEqual(pool.map((p) => p.word), ["a"]);
});

const withPool = (k) => Array.from({ length: k }, (_, i) => card(`other${i}`, { meaningVi: `nghĩa khác ${i}` }));

test("chooseKind: boxes 1 and 2 are flashcards", () => {
  const w = card("mitigate", { box: 2 });
  assert.equal(chooseKind(w, [w, ...withPool(5)]), "flashcard");
});

test("chooseKind box 3: choice needs a meaning and 3 other words with different meanings", () => {
  const w = card("mitigate", { box: 3 });
  assert.equal(chooseKind(w, [w, ...withPool(3)]), "choice");
  assert.equal(chooseKind(w, [w, ...withPool(2)]), "flashcard");
  const noMeaning = card("curb", { box: 3, meaningVi: "" });
  assert.equal(chooseKind(noMeaning, [noMeaning, ...withPool(5)]), "flashcard");
});

test("chooseKind box 4: fill needs a context sentence that contains the word; otherwise steps down", () => {
  const ctx = { sentence: "We must mitigate the risk.", source: { book: 15, test: 1 } };
  const w = card("mitigate", { box: 4, contexts: [ctx] });
  assert.equal(chooseKind(w, [w]), "fill");
  const noCtx = card("mitigate", { box: 4 });
  assert.equal(chooseKind(noCtx, [noCtx, ...withPool(3)]), "choice"); // steps down to choice
  assert.equal(chooseKind(noCtx, [noCtx, ...withPool(1)]), "flashcard");
  const wrongCtx = card("mitigate", { box: 4, contexts: [{ sentence: "Nothing about it here.", source: null }] });
  assert.equal(chooseKind(wrongCtx, [wrongCtx]), "flashcard");
  const noMeaning = card("mitigate", { box: 4, meaningVi: "", contexts: [ctx] });
  assert.equal(chooseKind(noMeaning, [noMeaning]), "flashcard"); // no meaning: flashcard only
});

test("chooseKind box 5: type needs a collocation (with the word) and a meaning; otherwise steps down", () => {
  const ctx = { sentence: "We must mitigate the risk.", source: null };
  const full = card("mitigate", { box: 5, collocations: ["mitigate the impact"], contexts: [ctx] });
  assert.equal(chooseKind(full, [full]), "type");
  const noColl = card("mitigate", { box: 5, contexts: [ctx] });
  assert.equal(chooseKind(noColl, [noColl]), "fill");
  const collWithoutWord = card("mitigate", { box: 5, collocations: ["reduce the impact"], contexts: [ctx] });
  assert.equal(chooseKind(collWithoutWord, [collWithoutWord]), "fill");
  const bare = card("mitigate", { box: 5 });
  assert.equal(chooseKind(bare, [bare, ...withPool(3)]), "choice");
  const noMeaning = card("mitigate", { box: 5, meaningVi: "", collocations: ["mitigate the impact"] });
  assert.equal(chooseKind(noMeaning, [noMeaning]), "flashcard");
});

// ---- building questions ----
test("shuffle keeps every item and does not change its input", () => {
  const list = [1, 2, 3, 4, 5];
  const out = shuffle(list, seeded(3));
  assert.deepEqual([...out].sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(list, [1, 2, 3, 4, 5]);
});

test("choice question: 4 options, one correct, 3 distinct wrong meanings from other words, context highlighted", () => {
  const ctx = { sentence: "Trees mitigate the noise.", source: { book: 14, test: 2, skill: "R", part: 3 } };
  const w = card("mitigate", { box: 3, meaningVi: "giảm nhẹ", contexts: [ctx] });
  const pool = withPool(6);
  const q = buildQuestion(w, "choice", [w, ...pool], { rng: seeded(11) });
  assert.equal(q.kind, "choice");
  assert.equal(q.options.length, 4);
  assert.equal(q.options.filter((o) => o.correct).length, 1);
  assert.equal(q.options[q.correctIndex].text, "giảm nhẹ");
  const texts = q.options.map((o) => o.text);
  assert.equal(new Set(texts).size, 4);
  for (const t of texts.filter((t) => t !== "giảm nhẹ")) assert.ok(pool.some((p) => p.meaningVi === t));
  assert.deepEqual([q.context.before, q.context.match, q.context.after], ["Trees ", "mitigate", " the noise."]);
  assert.deepEqual(q.context.source, ctx.source);
});

test("choice question without a usable context has context null", () => {
  const w = card("mitigate", { box: 3, contexts: [{ sentence: "No word here.", source: null }] });
  assert.equal(buildQuestion(w, "choice", [w, ...withPool(4)], { rng: seeded(2) }).context, null);
});

test("fill question: the sentence is split around the word as written, and base and written forms are accepted", () => {
  const w = card("mitigate", { box: 4, meaningVi: "giảm nhẹ", pos: "verb", contexts: [{ sentence: "Policies mitigated the harm.", source: { book: 15, test: 1 } }] });
  const q = buildQuestion(w, "fill", [w], { rng: seeded(1) });
  assert.deepEqual([q.before, q.match, q.after], ["Policies ", "mitigated", " the harm."]);
  assert.ok(q.accepted.includes("mitigated") && q.accepted.includes("mitigate"));
  assert.equal(q.meaningVi, "giảm nhẹ");
  assert.equal(q.pos, "verb");
  assert.deepEqual(q.source, { book: 15, test: 1 });
});

test("type question: one saved collocation with the main word hidden; the one used last time is avoided", () => {
  const w = card("mitigate", { box: 5, meaningVi: "giảm nhẹ", collocations: ["mitigate the impact", "mitigate risks", "mitigate climate change"] });
  const last = { ...w, lastCollocation: "mitigate the impact" };
  const low = buildQuestion(last, "type", [w], { rng: () => 0 }); // first of the remaining ones
  const high = buildQuestion(last, "type", [w], { rng: () => 0.99 }); // last of the remaining ones
  assert.equal(low.collocation, "mitigate risks");
  assert.equal(high.collocation, "mitigate climate change");
  assert.equal(low.match, "mitigate");
  assert.deepEqual([low.before, low.match, low.after], ["", "mitigate", " risks"]);
  // with no history, any of the three can come up
  const none = new Set([0, 0.4, 0.99].map((r) => buildQuestion(w, "type", [w], { rng: () => r }).collocation));
  assert.equal(none.size, 3);
  // a single collocation is used again
  const only = buildQuestion({ ...w, collocations: ["mitigate the impact"], lastCollocation: "mitigate the impact" }, "type", [w], { rng: seeded(1) });
  assert.equal(only.collocation, "mitigate the impact");
  assert.deepEqual([only.before, only.match, only.after], ["", "mitigate", " the impact"]);
  assert.ok(only.accepted.includes("mitigates") && only.accepted.includes("mitigated"));
  assert.equal(only.meaningVi, "giảm nhẹ");
});

test("flashcard question: meaning optional; carries the context and its source", () => {
  const ctx = { sentence: "We must mitigate the risk.", source: { book: 15, test: 3 } };
  const w = card("mitigate", { meaningVi: "", contexts: [ctx], collocations: ["mitigate risks"] });
  const q = buildQuestion(w, "flashcard", [w]);
  assert.equal(q.hasMeaning, false);
  assert.deepEqual(q.context, ctx);
  assert.deepEqual(q.collocations, ["mitigate risks"]);
  assert.equal(buildQuestion(card("x"), "flashcard", []).context, null);
});

// ---- grading ----
const fillQ = () => buildQuestion(card("alleviate", { box: 4, contexts: [{ sentence: "They alleviate pain.", source: null }] }), "fill", [], { rng: seeded(1) });
const typeQ = () => buildQuestion(card("mitigate", { box: 5, collocations: ["mitigate the impact"] }), "type", [], { rng: seeded(1) });

test("gradeAnswer choice: right option is correct, any other is wrong", () => {
  const w = card("mitigate", { box: 3, contexts: [] });
  const q = buildQuestion(w, "choice", [w, ...withPool(4)], { rng: seeded(5) });
  assert.equal(gradeAnswer(q, q.correctIndex), "correct");
  assert.equal(gradeAnswer(q, (q.correctIndex + 1) % 4), "wrong");
});

test("gradeAnswer fill: exact, near (one slip), wrong; hints turn correct into near", () => {
  assert.equal(gradeAnswer(fillQ(), "alleviate"), "correct");
  assert.equal(gradeAnswer(fillQ(), "  ALLEVIATE "), "correct");
  assert.equal(gradeAnswer(fillQ(), "alleviat"), "near");
  assert.equal(gradeAnswer(fillQ(), "reduce"), "wrong");
  assert.equal(gradeAnswer(fillQ(), ""), "wrong");
  assert.equal(gradeAnswer(fillQ(), "alleviate", { hintsUsed: 1 }), "near");
  assert.equal(gradeAnswer(fillQ(), "reduce", { hintsUsed: 2 }), "wrong");
});

test("gradeAnswer type: the main word (also inflected) or the whole phrase", () => {
  assert.equal(gradeAnswer(typeQ(), "mitigate"), "correct");
  assert.equal(gradeAnswer(typeQ(), "Mitigates"), "correct");
  assert.equal(gradeAnswer(typeQ(), "mitigating"), "correct");
  assert.equal(gradeAnswer(typeQ(), "mitigate the impact"), "correct");
  assert.equal(gradeAnswer(typeQ(), "mitigate  THE impact"), "correct");
  assert.equal(gradeAnswer(typeQ(), "mitigate the impac"), "near");
  assert.equal(gradeAnswer(typeQ(), "mitigat"), "near");
  assert.equal(gradeAnswer(typeQ(), "reduce"), "wrong");
  assert.equal(gradeAnswer(typeQ(), "mitigate", { hintsUsed: 1 }), "near");
});

test("gradeAnswer flashcard: forgot / vague / good", () => {
  const q = buildQuestion(card("x"), "flashcard", []);
  assert.equal(gradeAnswer(q, "forgot"), "wrong");
  assert.equal(gradeAnswer(q, "vague"), "near");
  assert.equal(gradeAnswer(q, "good"), "correct");
  assert.equal(gradeAnswer(q, "?"), "wrong");
  assert.equal(gradeAnswer(q, "good", { hintsUsed: 3 }), "correct"); // hints only matter when typing
});

test("applyOutcome: correct moves up one box and schedules by the new box", () => {
  assert.deepEqual(applyOutcome(card("a", { box: 1 }), "correct", TODAY), { lastReviewedAt: TODAY, box: 2, nextReview: "2026-11-15", lapses: 0 });
  assert.deepEqual(applyOutcome(card("a", { box: 4, lapses: 2 }), "correct", TODAY), { lastReviewedAt: TODAY, box: 5, nextReview: "2026-12-12", lapses: 2 });
  assert.deepEqual(applyOutcome(card("a", { box: 5 }), "correct", TODAY), { lastReviewedAt: TODAY, box: 5, nextReview: "2026-12-12", lapses: 0 });
});

test("applyOutcome: near keeps the box and reviews again tomorrow", () => {
  assert.deepEqual(applyOutcome(card("a", { box: 3, lapses: 1 }), "near", TODAY), { lastReviewedAt: TODAY, box: 3, nextReview: "2026-11-13", lapses: 1 });
});

test("applyOutcome: wrong goes to box 1 and adds a lapse", () => {
  assert.deepEqual(applyOutcome(card("a", { box: 4, lapses: 1 }), "wrong", TODAY), { lastReviewedAt: TODAY, box: 1, nextReview: "2026-11-13", lapses: 2 });
  assert.deepEqual(applyOutcome({ box: 1 }, "wrong", TODAY), { lastReviewedAt: TODAY, box: 1, nextReview: "2026-11-13", lapses: 1 });
});

test("applyOutcome does not change the card it is given", () => {
  const c = card("a", { box: 2 });
  const before = JSON.stringify(c);
  applyOutcome(c, "correct", TODAY);
  assert.equal(JSON.stringify(c), before);
});

test("outcomeMessage: a wrong answer never says 'Chính xác'", () => {
  assert.equal(outcomeMessage("wrong", 4, 1), "Sai · từ này quay lại hộp 1");
  assert.equal(outcomeMessage("near", 3, 3), "Gần đúng · giữ hộp 3, ôn lại ngày mai");
  assert.equal(outcomeMessage("correct", 2, 3), "Đúng · lên hộp 3");
  assert.equal(outcomeMessage("correct", 5, 5), "Đúng · giữ hộp 5, ôn lại sau 30 ngày");
  for (const [from, to] of [[1, 1], [3, 1], [5, 1]]) assert.ok(!/chính xác/i.test(outcomeMessage("wrong", from, to)));
});

test("hasMeaning ignores blank meanings", () => {
  assert.equal(hasMeaning({ meaningVi: "  " }), false);
  assert.equal(hasMeaning({ meaningVi: "x" }), true);
  assert.equal(hasMeaning({}), false);
});

test("canUseKind: unknown kind is false", () => {
  assert.equal(canUseKind("nonsense", card("a"), []), false);
});
