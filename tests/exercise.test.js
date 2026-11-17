import test from "node:test";
import assert from "node:assert/strict";
import { parseExerciseResult, pickThreePerError, AiFormatError } from "../js/ai/schema.js";
import { buildExercisePrompt } from "../js/ai/prompts.js";
import { startTask } from "../js/ai/index.js";
import {
  normalizeAnswer, changedSpan, gradeItem, applySelfGrade, isItemDone, isExerciseComplete, nextItemIndex, scoreOf, perErrorScores,
  fixedSuggestions, priorityAfter, practiceStats, practiceLabel, unfinishedExercises, recentExercises, isExerciseReady,
  validateSelection, pickExerciseErrors, exercisePromptErrors,
} from "../js/services/exercise.js";
import { pickWarmupErrors } from "../js/services/errors.js";
import { remapExerciseErrorId } from "../js/services/exercise-remap.js";
import { mergeData } from "../js/services/merge.js";

const SENT = [{ errorId: "e1", label: "He go to school." }, { errorId: "e2", label: "I have visited Paris last year." }];
const q = (id, errorId, kind, extra = {}) => ({
  id, errorId, kind,
  question: kind === "fill" ? "Technology ___ our lives." : kind === "choose" ? "Students need ___ to succeed." : kind === "correct" ? "She don't like coffee." : "Rewrite with the past simple: I have visited Berlin last week.",
  ...(kind === "choose" ? { options: ["advices", "advice", "an advice"] } : {}),
  answer: kind === "fill" ? "has changed" : kind === "choose" ? "advice" : kind === "correct" ? "She doesn't like coffee." : "I visited Berlin last week.",
  acceptedAnswers: [], explanationVi: "Giải thích.", ...extra,
});
const sixItems = () => [q("q1", "e1", "fill"), q("q2", "e1", "correct"), q("q3", "e1", "choose"), q("q4", "e2", "rewrite"), q("q5", "e2", "fill"), q("q6", "e2", "choose")];
const answer = (items, extra = {}) => JSON.stringify({ schemaVersion: 1, task: "exercise_generate", items, ...extra });
const parse = (items, extra) => parseExerciseResult(answer(items, extra), SENT);
const refused = (items, pattern, extra) => assert.throws(() => parse(items, extra), (e) => e instanceof AiFormatError && pattern.test(e.message) && /Không có gì được lưu/.test(e.message));

// ---- schema ----
test("exercise_generate: a valid answer with 3 questions for each of 2 mistakes is accepted", () => {
  const res = parse(sixItems());
  assert.equal(res.items.length, 6);
  assert.deepEqual(res.notes, []);
  assert.deepEqual(res.items.map((i) => i.id), ["q1", "q2", "q3", "q4", "q5", "q6"]);
  assert.deepEqual(res.items[2].options, ["advices", "advice", "an advice"]);
  assert.ok(!("options" in res.items[0])); // only choose has options
});

test("answer wrapped in chatter and a code fence is read", () => {
  const raw = `Đây là bài tập:\n\`\`\`json\n${answer(sixItems())}\n\`\`\`\nChúc bạn học tốt.`;
  assert.equal(parseExerciseResult(raw, SENT).items.length, 6);
});

test("wrong task, wrong schemaVersion, no items, not JSON: refused in Vietnamese", () => {
  assert.throws(() => parseExerciseResult(JSON.stringify({ schemaVersion: 1, task: "vocab_enrich", items: [] }), SENT), (e) => /vocab_enrich/.test(e.message) && /Không có gì được lưu/.test(e.message));
  assert.throws(() => parseExerciseResult(answer(sixItems(), { schemaVersion: 9 }), SENT), /schemaVersion 9/);
  assert.throws(() => parseExerciseResult(answer([]), SENT), /items/);
  assert.throws(() => parseExerciseResult("xin lỗi", SENT), /Không thấy JSON/);
});

test("an unknown errorId, a repeated id, a missing answer, a missing explanation, a bad kind are refused", () => {
  refused([...sixItems().slice(0, 5), q("q6", "zzz", "choose")], /errorId "zzz" không khớp/);
  refused([...sixItems().slice(0, 5), q("q5", "e2", "choose")], /id "q5" bị lặp/);
  refused([{ ...q("q1", "e1", "fill"), answer: "" }, ...sixItems().slice(1)], /thiếu answer/);
  refused([{ ...q("q1", "e1", "fill"), answer: undefined }, ...sixItems().slice(1)], /thiếu answer/);
  refused([{ ...q("q1", "e1", "fill"), explanationVi: "" }, ...sixItems().slice(1)], /thiếu explanationVi/);
  refused([{ ...q("q1", "e1", "fill"), kind: "match" }, ...sixItems().slice(1)], /kind "match"/);
  refused([{ ...q("q1", "e1", "fill"), question: "" }, ...sixItems().slice(1)], /thiếu question/);
  refused([{ ...q("q1", "e1", "fill"), id: "" }, ...sixItems().slice(1)], /thiếu id/);
  refused([{ ...q("q1", "e1", "fill"), acceptedAnswers: "x" }, ...sixItems().slice(1)], /acceptedAnswers/);
});

test("choose: the answer must be one of 3-4 different options (spacing, case and ’ ignored); it is kept as the option is shown", () => {
  refused([q("q3", "e1", "choose", { answer: "advise" }), ...sixItems().filter((i) => i.id !== "q3")], /answer "advise" không nằm trong options/);
  refused([q("q3", "e1", "choose", { options: ["advice", "advices"] }), ...sixItems().filter((i) => i.id !== "q3")], /3 hoặc 4 lựa chọn/);
  refused([q("q3", "e1", "choose", { options: ["a", "b", "c", "d", "e"], answer: "a" }), ...sixItems().filter((i) => i.id !== "q3")], /3 hoặc 4 lựa chọn/);
  refused([q("q3", "e1", "choose", { options: ["advice", "Advice", "x"] }), ...sixItems().filter((i) => i.id !== "q3")], /giống nhau/);
  refused([q("q3", "e1", "choose", { options: undefined }), ...sixItems().filter((i) => i.id !== "q3")], /options/);
  const res = parse([q("q3", "e1", "choose", { answer: "  ADVICE " }), ...sixItems().filter((i) => i.id !== "q3")]);
  assert.equal(res.items.find((i) => i.id === "q3").answer, "advice");
});

test("fill needs a blank (___) in the question", () => {
  refused([q("q1", "e1", "fill", { question: "Technology changes our lives." }), ...sixItems().slice(1)], /chỗ trống/);
});

test("fewer than 3 questions for a mistake: refused, naming the mistake and the number", () => {
  refused(sixItems().slice(0, 5), /Lỗi "I have visited Paris last year\." chỉ có 2 câu/);
  refused(sixItems().filter((i) => i.errorId === "e1"), /Lỗi "I have visited Paris last year\." chỉ có 0 câu/);
});

test("more than 3 for a mistake: NOT refused; the first 3 are kept, different kinds first, with a note", () => {
  const items = [q("a1", "e1", "fill"), q("a2", "e1", "fill"), q("a3", "e1", "fill"), q("a4", "e1", "choose"), q("a5", "e1", "correct"), ...sixItems().filter((i) => i.errorId === "e2")];
  const res = parse(items);
  assert.equal(res.items.length, 6);
  assert.deepEqual(res.items.filter((i) => i.errorId === "e1").map((i) => i.id), ["a1", "a4", "a5"]); // fill, choose, correct: three kinds
  assert.equal(res.notes.length, 1);
  assert.match(res.notes[0], /Claude gửi 5 câu, app giữ 3 câu đầu/);
  assert.match(res.notes[0], /He go to school\./);
});

test("pickThreePerError: different kinds first, then fills up in order; the kept ones stay in Claude's order", () => {
  const k = (id, kind) => ({ id, kind });
  assert.deepEqual(pickThreePerError([k(1, "fill"), k(2, "fill"), k(3, "fill"), k(4, "fill")]).map((i) => i.id), [1, 2, 3]);
  assert.deepEqual(pickThreePerError([k(1, "fill"), k(2, "fill"), k(3, "choose"), k(4, "fill"), k(5, "rewrite")]).map((i) => i.id), [1, 3, 5]);
  assert.deepEqual(pickThreePerError([k(1, "fill"), k(2, "choose"), k(3, "fill"), k(4, "fill")]).map((i) => i.id), [1, 2, 3]); // only 2 kinds: filled up in order
  assert.deepEqual(pickThreePerError([k(1, "a"), k(2, "b")]).map((i) => i.id), [1, 2]); // fewer: untouched
});

test("a question that reuses the learner's own wrong sentence is NOT a reason to refuse the JSON (the prompt asks, nothing more)", () => {
  const items = [q("q2", "e1", "correct", { question: "He go to school.", answer: "He goes to school." }), ...sixItems().filter((i) => i.id !== "q2")];
  assert.equal(parse(items).items.length, 6);
});

test("many problems: the first 3 are shown with a count of the rest", () => {
  const bad = ["q1", "q2", "q3", "q4", "q5"].map((id) => ({ ...q(id, "e1", "fill"), answer: "" }));
  assert.throws(() => parse(bad), (e) => /và 2 lỗi nữa/.test(e.message));
});

// ---- prompt ----
const PROMPT_ERRORS = [
  { errorId: "e1", label: "He go to school.", original: "He go to school.", corrected: "He goes to school.", type: "subject-verb-agreement", signature: "subject-verb-agreement:third-person-s", ruleVi: "Chủ ngữ ngôi thứ ba số ít thêm s.", correctExample: "She works hard." },
  { errorId: "e2", label: "x", original: "I have visited Paris last year.", corrected: "I visited Paris last year.", type: "tenses", signature: "tenses:present-perfect-vs-past-simple" },
];

test("the prompt: exactly 3 questions per mistake, 4 kinds, new sentences, no Cambridge, ids, JSON only", () => {
  const p = buildExercisePrompt(PROMPT_ERRORS);
  assert.match(p, /ONE JSON object and nothing else/);
  assert.match(p, /EXACTLY 3 questions for each mistake \(6 in all\)/);
  for (const kind of ["fill", "correct", "choose", "rewrite"]) assert.match(p, new RegExp(`"${kind}"`));
  assert.match(p, /at least two different kinds/);
  assert.match(p, /___ \(three underscores\)/);
  assert.match(p, /Do NOT reuse the learner's own wrong sentence/);
  assert.match(p, /Do not mention Cambridge/);
  assert.match(p, /acceptedAnswers/);
  assert.match(p, /IELTS Academic topics/);
  assert.match(p, /explanationVi/);
  assert.match(p, /"errorId": "e1"/);
  assert.match(p, /"errorId": "e2"/);
  assert.match(p, /"learnerWrongSentence": "He go to school\."/);
  assert.match(p, /"ruleVi"/);
  assert.ok(!/ruleVi[^\n]*\n[^\n]*"errorId": "e2"[^\n]*\n[^\n]*"ruleVi"/.test(p));
});

test("the prompt refuses no mistakes and more than 5; it carries no book, test or progress", () => {
  assert.throws(() => buildExercisePrompt([]), /Chưa chọn lỗi/);
  assert.throws(() => buildExercisePrompt(Array.from({ length: 6 }, (_, i) => ({ ...PROMPT_ERRORS[0], errorId: `e${i}` }))), /tối đa 5/);
  assert.ok(!/Cam \d|Test \d|"box"|"occurrences"/.test(buildExercisePrompt(PROMPT_ERRORS)));
});

test("startTask('exercise_generate'): the session's accept() checks the answer against the mistakes that were sent", () => {
  const session = startTask("exercise_generate", { errors: PROMPT_ERRORS });
  assert.equal(session.mode, "manual");
  assert.equal(session.accept(answer(sixItems())).items.length, 6);
  assert.throws(() => session.accept(answer(sixItems().map((i) => ({ ...i, errorId: "other" })))), AiFormatError);
});

// ---- normalising and marking ----
test("normalizeAnswer: case, spaces, ' and ’, quotes, dashes, the punctuation at the end", () => {
  assert.equal(normalizeAnswer("  Has   Changed. "), "has changed");
  assert.equal(normalizeAnswer("She doesn’t like it!"), "she doesn't like it");
  assert.equal(normalizeAnswer("She doesn't like it?"), "she doesn't like it");
  assert.equal(normalizeAnswer("“Quoted” text;"), '"quoted" text');
  assert.equal(normalizeAnswer("well–known"), "well-known");
  assert.equal(normalizeAnswer("wait…"), "wait");
  assert.equal(normalizeAnswer("a, b, c."), "a, b, c"); // inside the text, punctuation stays
  assert.equal(normalizeAnswer(null), "");
  assert.equal(normalizeAnswer("   "), "");
});

test("gradeItem fill: answer or acceptedAnswers (after normalising) is right; anything else is wrong but can be overridden", () => {
  const fill = q("f", "e1", "fill", { acceptedAnswers: ["has transformed"] });
  assert.deepEqual(gradeItem(fill, "Has changed."), { correct: true, matched: "answer", selfGrade: null });
  assert.deepEqual(gradeItem(fill, "  HAS   TRANSFORMED "), { correct: true, matched: "answer", selfGrade: null });
  assert.deepEqual(gradeItem(fill, "changed"), { correct: false, matched: null, selfGrade: "override" });
  assert.deepEqual(gradeItem(fill, ""), { correct: false, matched: null, selfGrade: null });
});

test("gradeItem choose: marked by the option; no self-grading", () => {
  const c = q("c", "e1", "choose");
  assert.equal(gradeItem(c, "advice").correct, true);
  assert.equal(gradeItem(c, "Advice").correct, true);
  assert.deepEqual(gradeItem(c, "advices"), { correct: false, matched: null, selfGrade: null });
});

test("gradeItem correct: the whole sentence (normalised) is right; a wrong sentence is wrong but can be overridden", () => {
  const c = q("c", "e1", "correct");
  assert.equal(gradeItem(c, "She doesn’t like coffee").correct, true);
  assert.equal(gradeItem(c, "she DOESN'T  like coffee.").matched, "answer");
  assert.deepEqual(gradeItem(c, "She do not like coffee."), { correct: false, matched: null, selfGrade: "override" });
  assert.equal(gradeItem(c, "She don't like coffee.").correct, false); // the original sentence is not a correction
});

test("gradeItem correct: typing only the corrected part is accepted when it is the changed part of the answer", () => {
  const c = q("c", "e1", "correct");
  assert.deepEqual(gradeItem(c, "doesn't"), { correct: true, matched: "span", selfGrade: null });
  assert.equal(gradeItem(c, "doesn’t.").correct, true);
  assert.equal(gradeItem(c, "does not").correct, false);
  assert.equal(gradeItem(c, "like").correct, false); // a word that did not change
  const multi = { kind: "correct", question: "He have been working here since three years.", answer: "He has been working here for three years.", acceptedAnswers: [] };
  assert.equal(changedSpan(multi.question, multi.answer), "has been working here for");
  assert.equal(gradeItem(multi, "has been working here for").correct, true); // from the first change to the last
  assert.equal(gradeItem(multi, "has").correct, false); // only one of the two fixes: not enough
  assert.equal(gradeItem(multi, "for").correct, false);
  assert.equal(gradeItem(multi, "has been").correct, false);
  assert.equal(gradeItem(multi, "He has been working here for three years.").correct, true);
});

test("gradeItem correct: acceptedAnswers give their own changed parts; a pure deletion has no part to type", () => {
  const withAlt = { kind: "correct", question: "She don't like coffee.", answer: "She doesn't like coffee.", acceptedAnswers: ["She does not like coffee."] };
  assert.equal(gradeItem(withAlt, "does not").correct, true);
  assert.equal(gradeItem(withAlt, "She does not like coffee").correct, true);
  const del = { kind: "correct", question: "We use the technology daily.", answer: "We use technology daily.", acceptedAnswers: [] };
  assert.equal(changedSpan(del.question, del.answer), ""); // only a word was removed
  assert.equal(gradeItem(del, "We use technology daily").correct, true);
  assert.equal(gradeItem(del, "technology").correct, false);
  assert.equal(gradeItem(del, "technology").selfGrade, "override");
});

test("changedSpan: from the first to the last changed word of the answer", () => {
  assert.equal(changedSpan("She don't like coffee.", "She doesn't like coffee."), "doesn't");
  assert.equal(changedSpan("a b c d e", "a X c Y e"), "X c Y");
  assert.equal(changedSpan("same words", "same words"), "");
  assert.equal(changedSpan("The technology has changed.", "Technology has changed."), "Technology"); // a capital letter is a change
});

test("gradeItem rewrite: a match is right; no match waits for the learner's own mark", () => {
  const r = q("r", "e2", "rewrite", { acceptedAnswers: ["Last week I visited Berlin."] });
  assert.equal(gradeItem(r, "I visited Berlin last week.").correct, true);
  assert.equal(gradeItem(r, "last week i visited berlin").correct, true);
  assert.deepEqual(gradeItem(r, "Last week I went to Berlin."), { correct: null, matched: null, selfGrade: "choice" });
});

test("applySelfGrade: 'Tôi đúng ý' turns a wrong into right; the rewrite choice sets either; both are marked selfGraded", () => {
  const wrong = { ...q("f", "e1", "fill"), userAnswer: "changed", correct: false, selfGraded: false };
  assert.deepEqual({ c: applySelfGrade(wrong, true).correct, s: applySelfGrade(wrong, true).selfGraded }, { c: true, s: true });
  const pending = { ...q("r", "e2", "rewrite"), userAnswer: "x", correct: null, selfGraded: false };
  assert.equal(applySelfGrade(pending, false).correct, false);
  assert.equal(applySelfGrade(pending, false).selfGraded, true);
  assert.equal(wrong.correct, false); // the input is not changed
});

// ---- progress and score ----
const exercise = (marks, extra = {}) => ({
  id: "x1", errorIds: ["e1", "e2"], doneAt: null, createdAt: "2026-03-01T10:00:00Z",
  items: sixItems().map((it, i) => ({ ...it, userAnswer: marks[i] === undefined ? null : "a", correct: marks[i] === undefined ? null : marks[i], selfGraded: false })), ...extra,
});

test("progress: first item without an answer, or whose own mark is still waiting", () => {
  assert.equal(nextItemIndex(exercise([])), 0);
  assert.equal(nextItemIndex(exercise([true, false])), 2);
  assert.equal(nextItemIndex(exercise([true, true, true, null])), 3); // a rewrite answered but not marked yet
  assert.equal(isItemDone(exercise([true]).items[0]), true);
  assert.equal(isItemDone(exercise([null]).items[0]), false);
  assert.equal(isExerciseComplete(exercise([true, true, true, true, true, true])), true);
  assert.equal(isExerciseComplete(exercise([true, true, true, true, true])), false);
  assert.equal(nextItemIndex(exercise([true, true, true, true, true, true])), -1);
});

test("score of each mistake: correct / total in the order the mistakes appear; the total score counts the right ones", () => {
  const ex = exercise([true, true, false, true, false, false]);
  assert.deepEqual(perErrorScores(ex), [{ errorId: "e1", correct: 2, total: 3 }, { errorId: "e2", correct: 1, total: 3 }]);
  assert.equal(scoreOf(ex), 3);
  assert.deepEqual(perErrorScores(exercise([true, true, true, true, true, true])).map((p) => `${p.correct}/${p.total}`), ["3/3", "3/3"]);
});

test("'Đánh dấu đã khắc phục' is suggested only for a mistake right in all 3 questions and not fixed yet", () => {
  const per = perErrorScores(exercise([true, true, true, true, false, true]));
  const errors = [{ id: "e1", status: "practicing" }, { id: "e2", status: "new" }];
  assert.deepEqual(fixedSuggestions(per, errors), ["e1"]);
  assert.deepEqual(fixedSuggestions(per, [{ id: "e1", status: "fixed" }, { id: "e2", status: "new" }]), []);
  assert.deepEqual(fixedSuggestions(per, [{ id: "e1", status: "new", deleted: true }]), []);
  assert.deepEqual(fixedSuggestions(per, []), []);
  assert.deepEqual(fixedSuggestions([{ errorId: "e1", correct: 2, total: 2 }], errors), []); // fewer than 3 questions: not enough evidence
});

test("warm-up priority after an exercise: as many as the questions got wrong, 0 when all right", () => {
  const per = perErrorScores(exercise([true, false, false, true, true, true]));
  assert.deepEqual(priorityAfter(per), [{ errorId: "e1", warmupPriority: 2 }, { errorId: "e2", warmupPriority: 0 }]);
});

test("practice stats: 'Đã luyện N lần · lần cuối X/3' from the finished exercises of that mistake", () => {
  const done = (id, doneAt, marks) => ({ ...exercise(marks), id, doneAt });
  const exs = [done("a", "2026-03-01T10:00:00Z", [true, true, true, false, false, false]), done("b", "2026-03-05T10:00:00Z", [true, false, false, true, true, true]), exercise([true]), { ...done("c", "2026-03-09T10:00:00Z", [true, true, true, true, true, true]), deleted: true }];
  assert.deepEqual(practiceStats("e1", exs), { count: 2, correct: 1, total: 3 });
  assert.equal(practiceLabel(practiceStats("e1", exs)), "Đã luyện 2 lần · lần cuối 1/3");
  assert.equal(practiceLabel(practiceStats("e2", exs)), "Đã luyện 2 lần · lần cuối 3/3");
  assert.equal(practiceStats("nope", exs), null);
  assert.equal(practiceLabel(null), "");
  assert.equal(practiceStats("e1", [exercise([true])]), null); // an unfinished exercise does not count
});

test("lists: unfinished first-by-newest, recent finished (at most 5), deleted ones are ignored", () => {
  const exs = [
    { id: "u1", createdAt: "2026-03-01T00:00:00Z", doneAt: null, items: [] },
    { id: "u2", createdAt: "2026-03-02T00:00:00Z", doneAt: null, items: [] },
    { id: "ud", createdAt: "2026-03-03T00:00:00Z", doneAt: null, items: [], deleted: true },
    ...Array.from({ length: 7 }, (_, i) => ({ id: `d${i}`, createdAt: "2026-02-01T00:00:00Z", doneAt: `2026-03-0${i + 1}T00:00:00Z`, items: [] })),
  ];
  assert.deepEqual(unfinishedExercises(exs).map((e) => e.id), ["u2", "u1"]);
  assert.deepEqual(recentExercises(exs).map((e) => e.id), ["d6", "d5", "d4", "d3", "d2"]);
});

// ---- which mistakes ----
const err = (id, extra = {}) => ({ id, original: `wrong ${id}`, corrected: `right ${id}`, type: "tenses", signature: `tenses:${id}`, enriched: true, status: "new", occurrences: 1, lastSeen: "2026-03-01", ...extra });

test("a mistake can be practised only when Claude has finished it: enriched, a real signature, a correct sentence, not deleted", () => {
  assert.equal(isExerciseReady(err("a")), true);
  assert.equal(isExerciseReady(err("a", { enriched: false })), false);
  assert.equal(isExerciseReady(err("a", { signature: "pending:a" })), false);
  assert.equal(isExerciseReady(err("a", { signature: "" })), false);
  assert.equal(isExerciseReady(err("a", { corrected: " " })), false);
  assert.equal(isExerciseReady(err("a", { deleted: true })), false);
  assert.equal(isExerciseReady(err("a", { status: "fixed" })), true); // a fixed one may be tested again by choice
});

test("selection: 1 to 5 ready mistakes; the message names the ones that are not ready", () => {
  assert.equal(validateSelection([err("a")]), "");
  assert.equal(validateSelection(Array.from({ length: 5 }, (_, i) => err(`m${i}`))), "");
  assert.match(validateSelection([]), /Chọn ít nhất một lỗi/);
  assert.match(validateSelection(Array.from({ length: 6 }, (_, i) => err(`m${i}`))), /tối đa 5.*đang chọn 6/);
  const msg = validateSelection([err("a"), err("b", { enriched: false, original: "Many peoples agree." })]);
  assert.match(msg, /1 lỗi chưa hoàn thiện/);
  assert.match(msg, /Many peoples agree/);
});

test("with nothing selected the 5 mistakes of rule 6.4 are proposed: only ready, not fixed, priority first, then occurrences, then newest", () => {
  const errors = [
    err("many", { occurrences: 9 }), err("recent", { occurrences: 2, lastSeen: "2026-03-09" }), err("old", { occurrences: 2, lastSeen: "2026-01-01" }),
    err("boost", { occurrences: 1, warmupPriority: 2 }), err("fixed", { occurrences: 20, status: "fixed" }), err("pending", { occurrences: 30, enriched: false }),
    err("a1"), err("a2"),
  ];
  assert.deepEqual(pickExerciseErrors(errors).map((e) => e.id), ["boost", "many", "recent", "old", "a1"]);
  assert.deepEqual(pickExerciseErrors([err("pending", { enriched: false })]), []);
});

test("warm-up selection (6.4): the mistakes got wrong in an exercise come first, then the old order", () => {
  const errors = [err("a", { occurrences: 5 }), err("b", { occurrences: 1, warmupPriority: 1 }), err("c", { occurrences: 3, warmupPriority: 3 }), err("d", { occurrences: 9, status: "fixed", warmupPriority: 9 })];
  assert.deepEqual(pickWarmupErrors(errors, 5).map((e) => e.id), ["c", "b", "a"]);
  assert.deepEqual(pickWarmupErrors([err("a", { occurrences: 5 }), err("b", { occurrences: 7 })], 5).map((e) => e.id), ["b", "a"]); // no priority: as before
});

test("what is sent about each mistake: its sentences, type, signature and the rule; no source", () => {
  const [e] = exercisePromptErrors([err("a", { explanationVi: "Quy tắc.", correctExample: "Ex.", occurrences: 4 })]);
  assert.deepEqual(e, { errorId: "a", label: "wrong a", original: "wrong a", corrected: "right a", type: "tenses", signature: "tenses:a", ruleVi: "Quy tắc.", correctExample: "Ex." });
});

// ---- merging mistakes keeps the exercises pointing at the right card ----
test("remapExerciseErrorId: the list and every question point at the card that was kept", () => {
  const ex = { id: "x", errorIds: ["e1", "e2"], items: [{ errorId: "e1" }, { errorId: "e2" }, { errorId: "e2" }] };
  const out = remapExerciseErrorId(ex, "e2", "e1");
  assert.deepEqual(out.errorIds, ["e1"]);
  assert.deepEqual(out.items.map((i) => i.errorId), ["e1", "e1", "e1"]);
  assert.deepEqual(ex.errorIds, ["e1", "e2"]); // the input is not changed
});

test("merging data from two machines: questions that pointed at the card that was folded now point at the kept one", () => {
  const e = (id, createdAt) => ({ id, original: id, corrected: "c", type: "tenses", signature: "tenses:x", occurrences: 1, status: "new", createdAt, updatedAt: createdAt, deleted: false });
  const ex = { id: "x1", errorIds: ["e2"], items: [{ id: "q1", errorId: "e2", userAnswer: "a", correct: true }], createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z", deleted: false };
  const merged = mergeData({ errors: [e("e1", "2026-01-01T00:00:00Z")] }, { errors: [e("e2", "2026-01-05T00:00:00Z")], exercises: [ex] });
  assert.equal(merged.errors.filter((x) => !x.deleted).length, 1);
  const kept = merged.errors[0].id;
  assert.equal(merged.exercises[0].items[0].errorId, kept);
  assert.deepEqual(merged.exercises[0].errorIds, [kept]);
});
