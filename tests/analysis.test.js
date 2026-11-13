import test from "node:test";
import assert from "node:assert/strict";
import { parseAnalysisResult, AiFormatError, CRITERIA } from "../js/ai/schema.js";
import { buildAnalysisPrompt } from "../js/ai/prompts.js";
import { startTask } from "../js/ai/index.js";
import {
  overallFromCriteria, overallInfo, bandsRecord, locateErrors, buildTray, findExistingError, findExistingVocab,
  pickerSubmissions, submissionLabel, taskFor,
} from "../js/services/analysis.js";
import { diffWords } from "../js/services/diff.js";

const err = (extra = {}) => ({
  original: "the technology has changed", corrected: "technology has changed", type: "articles",
  signature: "articles:zero-article-uncountable", explanationVi: "Danh từ không đếm được.", correctExample: "Information is power.", severity: "medium", ...extra,
});
const sug = (extra = {}) => ({ word: "mitigate", lemma: "mitigate", pos: "verb", ipa: "/ˈmɪtɪɡeɪt/", meaningVi: "giảm nhẹ", collocations: ["mitigate the impact"], example: "We must mitigate risk.", ...extra });
const answer = (task, extra = {}) => ({
  schemaVersion: 1, task,
  bands: { overall: 6.0, ...Object.fromEntries(CRITERIA[task].map((c) => [c, 6.0])) },
  criteriaFeedbackVi: Object.fromEntries(CRITERIA[task].map((c) => [c, "Nhận xét."])),
  errors: [err()], minimalCorrectedText: "Technology has changed.", band7Text: "A better version.", vocabularySuggestions: [sug()],
  ...(task === "writing_task1" ? { dataAccuracyChecked: true } : {}), ...extra,
});
const parse = (task, obj) => parseAnalysisResult(task, JSON.stringify(obj));
const fails = (task, obj, pattern) => assert.throws(() => parse(task, obj), (e) => e instanceof AiFormatError && pattern.test(e.message) && /Không có gì được lưu/.test(e.message));

test("the three tasks have their own criteria sets", () => {
  assert.deepEqual(CRITERIA.writing_task1, ["TA", "CC", "LR", "GRA"]);
  assert.deepEqual(CRITERIA.writing_task2, ["TR", "CC", "LR", "GRA"]);
  assert.deepEqual(CRITERIA.speaking, ["FC", "LR", "GRA", "P"]);
});

test("valid answers for writing_task1, writing_task2 and speaking are accepted and cleaned", () => {
  for (const task of ["writing_task1", "writing_task2", "speaking"]) {
    const res = parse(task, answer(task));
    assert.equal(res.task, task);
    assert.equal(res.errors.length, 1);
    assert.equal(res.vocabularySuggestions[0].lemma, "mitigate");
  }
  assert.equal(parse("writing_task1", answer("writing_task1")).dataAccuracyChecked, true);
  assert.equal(parse("writing_task2", answer("writing_task2")).dataAccuracyChecked, null);
});

test("answer can be wrapped in chatter and a code fence; an empty error list and no suggestions are fine", () => {
  const raw = `Đây là kết quả:\n\`\`\`json\n${JSON.stringify(answer("writing_task2", { errors: [], vocabularySuggestions: undefined }))}\n\`\`\``;
  const res = parseAnalysisResult("writing_task2", raw);
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.vocabularySuggestions, []);
});

test("a wrong task is refused with the name of the task that was pasted", () => {
  assert.throws(() => parse("writing_task2", answer("writing_task1")), (e) => /writing_task1/.test(e.message) && /writing_task2/.test(e.message));
  assert.throws(() => parse("speaking", answer("writing_task2")), AiFormatError);
});

test("the wrong criteria set is refused: TR in Task 1, TA in Task 2, P in Writing, missing criterion", () => {
  const swap = (task, from, to) => {
    const a = answer(task);
    a.bands[to] = a.bands[from]; delete a.bands[from];
    return a;
  };
  fails("writing_task1", swap("writing_task1", "TA", "TR"), /TR.*không thuộc bộ tiêu chí|thiếu TA/);
  fails("writing_task2", swap("writing_task2", "TR", "TA"), /TA.*không thuộc bộ tiêu chí|thiếu TR/);
  fails("writing_task2", swap("writing_task2", "GRA", "P"), /không thuộc bộ tiêu chí/);
  const missing = answer("speaking"); delete missing.bands.FC;
  fails("speaking", missing, /bands thiếu FC/);
  const fb = answer("speaking"); delete fb.criteriaFeedbackVi.P;
  fails("speaking", fb, /thiếu nhận xét P/);
  const fbExtra = answer("writing_task2"); fbExtra.criteriaFeedbackVi.TA = "x";
  fails("writing_task2", fbExtra, /criteriaFeedbackVi có tiêu chí "TA"/);
});

test("bands must be numbers from 0 to 9 in steps of 0.5", () => {
  for (const bad of [9.5, -1, 6.3, 6.25, "6.5", null, NaN]) {
    const a = answer("writing_task2"); a.bands.LR = bad;
    fails("writing_task2", a, /bands\.LR/);
  }
  const o = answer("writing_task2"); o.bands.overall = 10;
  fails("writing_task2", o, /bands\.overall/);
  for (const good of [0, 0.5, 9, 5.5]) { const a = answer("writing_task2"); a.bands.LR = good; assert.equal(parse("writing_task2", a).bands.LR, good); }
});

test("a missing field is reported: errors list, original, explanation, band7Text, minimalCorrectedText, suggestion fields", () => {
  const no = (patch) => answer("writing_task2", patch);
  fails("writing_task2", no({ errors: "none" }), /"errors" phải là một danh sách/);
  fails("writing_task2", no({ errors: [err({ original: "" })] }), /Lỗi 1.*thiếu original/);
  fails("writing_task2", no({ errors: [err({ explanationVi: "" })] }), /thiếu explanationVi/);
  fails("writing_task2", no({ errors: [err({ type: "grammar" })] }), /không thuộc 10 nhóm/);
  fails("writing_task2", no({ errors: [err({ signature: "tenses:x" })] }), /phải bắt đầu bằng "articles:"/);
  fails("writing_task2", no({ errors: [err({ severity: "huge" })] }), /severity/);
  fails("writing_task2", no({ band7Text: "" }), /thiếu band7Text/);
  fails("writing_task2", no({ minimalCorrectedText: undefined }), /thiếu minimalCorrectedText/);
  fails("writing_task2", no({ vocabularySuggestions: [sug({ meaningVi: "" })] }), /Từ gợi ý 1.*thiếu meaningVi/);
  fails("writing_task2", no({ vocabularySuggestions: [sug({ pos: "pronoun" })] }), /pos "pronoun"/);
  const noBands = answer("writing_task2"); delete noBands.bands;
  fails("writing_task2", noBands, /thiếu "bands"/);
});

test("Task 1 needs dataAccuracyChecked (true or false); other tasks do not", () => {
  const a = answer("writing_task1"); delete a.dataAccuracyChecked;
  fails("writing_task1", a, /dataAccuracyChecked/);
  assert.equal(parse("writing_task1", answer("writing_task1", { dataAccuracyChecked: false })).dataAccuracyChecked, false);
  assert.equal(parse("speaking", answer("speaking")).dataAccuracyChecked, null);
});

test("start/end are only hints: bad numbers are dropped instead of failing the answer", () => {
  const res = parse("writing_task2", answer("writing_task2", { errors: [err({ start: 112, end: 138 }), err({ original: "a b", start: 50, end: 10 }), err({ original: "c d", start: "x", end: 3 })] }));
  assert.deepEqual([res.errors[0].start, res.errors[0].end], [112, 138]);
  assert.deepEqual([res.errors[1].start, res.errors[1].end], [null, null]);
  assert.deepEqual([res.errors[2].start, res.errors[2].end], [null, null]);
  assert.equal(res.errors[0].severity, "medium");
  assert.equal(parse("writing_task2", answer("writing_task2", { errors: [err({ severity: undefined })] })).errors[0].severity, "medium");
});

test("the overall band the app uses is the average of the 4 criteria rounded to the nearest 0.5 (rule 6.1)", () => {
  const at = (TR, CC, LR, GRA) => overallFromCriteria("writing_task2", { TR, CC, LR, GRA });
  assert.equal(at(6, 6, 6, 6), 6);
  assert.equal(at(6, 6.5, 6, 6), 6); // 6.125 -> 6.0
  assert.equal(at(6, 6, 6.5, 6.5), 6.5); // 6.25 -> 6.5
  assert.equal(at(6.5, 6.5, 7, 6.5), 6.5); // 6.625 -> 6.5
  assert.equal(at(7, 7, 6.5, 6.5), 7); // 6.75 -> 7.0
  assert.equal(at(5.5, 6, 6, 6), 6); // 5.875 -> 6.0
});
test("overallInfo: same -> no difference; different -> both are kept and the computed one is used", () => {
  const same = { task: "writing_task2", bands: { overall: 6.0, TR: 6, CC: 6, LR: 6, GRA: 6 } };
  assert.deepEqual(overallInfo(same), { claude: 6, computed: 6, differs: false });
  const off = { task: "writing_task2", bands: { overall: 7.0, TR: 6, CC: 6.5, LR: 6, GRA: 6.5 } }; // 25/4 = 6.25 -> 6.5
  assert.deepEqual(overallInfo(off), { claude: 7, computed: 6.5, differs: true });
  const rec = bandsRecord(off);
  assert.equal(rec.overall, 6.5);
  assert.equal(rec.claudeOverall, 7);
  assert.deepEqual([rec.c1, rec.c2, rec.c3, rec.c4], [6, 6.5, 6, 6.5]); // TR, CC, LR, GRA
  const sp = { task: "speaking", bands: { overall: 6, FC: 7, LR: 6, GRA: 6, P: 5.5 } };
  assert.deepEqual([bandsRecord(sp).c1, bandsRecord(sp).c4], [7, 5.5]); // FC ... P
  assert.equal(overallFromCriteria("speaking", sp.bands), 6.0); // 24.5/4 = 6.125 -> 6.0
});

test("a different overall from Claude does not reject the JSON", () => {
  const a = answer("writing_task2"); a.bands.overall = 8.5;
  assert.equal(parse("writing_task2", a).bands.overall, 8.5);
});

// ---- highlight ----
const TEXT = "In my opinion the technology has changed a lot. Also the technology has changed our lives.";

test("locateErrors: marks every place where the wrong phrase is found, even when start/end are right for one only", () => {
  const first = TEXT.indexOf("the technology has changed");
  const res = locateErrors(TEXT, [err({ start: first, end: first + "the technology has changed".length })]);
  const marks = res.segments.filter((s) => s.errorIndex === 0);
  assert.equal(marks.length, 2);
  assert.equal(res.segments.map((s) => s.text).join(""), TEXT); // nothing lost, nothing added
  assert.deepEqual(res.located, [0]);
  assert.deepEqual(res.missing, []);
});

test("locateErrors: start/end that are off are ignored, the text is searched for `original`", () => {
  const res = locateErrors(TEXT, [err({ start: 3, end: 9 })]);
  assert.equal(res.segments.filter((s) => s.errorIndex === 0).length, 2);
  const none = locateErrors(TEXT, [err({ start: 0, end: 5000 })]);
  assert.equal(none.segments.filter((s) => s.errorIndex === 0).length, 2);
});

test("locateErrors: whole words only (no mark inside another word), unless start/end point exactly there", () => {
  const t = "I went ago and then I go.";
  assert.equal(locateErrors(t, [err({ original: "go" })]).segments.filter((s) => s.errorIndex === 0).length, 1);
  const hint = t.indexOf("go");
  const res = locateErrors(t, [err({ original: "go", start: hint, end: hint + 2 })]);
  assert.ok(res.segments.some((s) => s.errorIndex === 0 && s.text === "go"));
});

test("locateErrors: not found -> missing; case and line breaks are forgiven only when there is no exact match", () => {
  const miss = locateErrors("Nothing here.", [err({ original: "absent phrase" })]);
  assert.deepEqual(miss.missing, [0]);
  assert.equal(miss.segments.length, 1);
  const loose = locateErrors("The technology\nhas changed.", [err({ original: "the technology has changed" })]);
  assert.deepEqual(loose.located, [0]);
  assert.equal(loose.segments.find((s) => s.errorIndex === 0).text, "The technology\nhas changed");
});

test("locateErrors: overlapping marks keep the earlier (then the longer) one; several errors are told apart", () => {
  const t = "He go to school every day.";
  const res = locateErrors(t, [err({ original: "go to school", signature: "tenses:x", type: "tenses" }), err({ original: "He go", signature: "subject-verb-agreement:x", type: "subject-verb-agreement" })]);
  const marks = res.segments.filter((s) => s.errorIndex !== null);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].text, "He go"); // starts earlier
  assert.deepEqual(res.located, [1]);
  assert.deepEqual(res.missing, [0]);
});

test("locateErrors on empty text or empty list", () => {
  assert.deepEqual(locateErrors("", []).segments, []);
  assert.deepEqual(locateErrors("Hello world", []).segments, [{ text: "Hello world", errorIndex: null }]);
});

test("diffWords can compare a whole essay when asked (default limit would skip it)", () => {
  const a = Array.from({ length: 250 }, (_, i) => `word${i}`).join(" ");
  const b = a.replace("word10 ", "WORD10 ");
  const skipped = diffWords(a, b);
  assert.ok(skipped.wrong.every((t) => t.changed === false)); // 250 x 250 > 40000: no comparison
  const full = diffWords(a, b, { maxCells: 1500000 });
  assert.deepEqual(full.wrong.filter((t) => t.changed).map((t) => t.text), ["word10"]);
  assert.deepEqual(full.right.filter((t) => t.changed).map((t) => t.text), ["WORD10"]);
});

// ---- trays ----
const stored = (id, extra = {}) => ({ id, createdAt: "2026-01-01T00:00:00Z", deleted: false, ...extra });

test("tray labels: Mới, Đã có · lần N (errors by occurrences, words by recorded occurrences), same card never listed twice", () => {
  const result = parse("writing_task2", answer("writing_task2", {
    errors: [err(), err({ original: "other mistake", signature: "tenses:past-simple", type: "tenses", severity: "low" }), err({ original: "the technology has changed", severity: "high" })],
    vocabularySuggestions: [sug(), sug({ lemma: "alleviate", word: "alleviate" }), sug()],
  }));
  const tray = buildTray(result, {
    errors: [stored("e1", { signature: "articles:zero-article-uncountable", original: "x", occurrences: 3 })],
    vocab: [stored("v1", { lemma: "mitigate", word: "mitigate", pos: "verb" })],
    occurrences: [{ itemType: "vocab", itemId: "v1" }, { itemType: "vocab", itemId: "v1" }, { itemType: "error", itemId: "e1" }],
  });
  assert.equal(tray.errors.length, 2); // the repeated identical error is listed once
  assert.equal(tray.errors[0].label, "Đã có · lần 3");
  assert.equal(tray.errors[1].label, "Mới");
  assert.equal(tray.vocab.length, 2);
  assert.equal(tray.vocab[0].label, "Đã có · lần 2");
  assert.equal(tray.vocab[1].label, "Mới");
});

test("tray: high and medium are ticked, low is not; items already saved from this piece are marked and not ticked", () => {
  const result = parse("writing_task2", answer("writing_task2", {
    errors: [err({ severity: "high" }), err({ original: "b", signature: "tenses:x", type: "tenses", severity: "medium" }), err({ original: "c", signature: "tenses:y", type: "tenses", severity: "low" })],
  }));
  const tray = buildTray(result, { saved: { errors: ["articles:zero-article-uncountable|the technology has changed"], vocab: ["mitigate|verb"] } });
  assert.deepEqual(tray.errors.map((r) => r.checked), [false, true, false]);
  assert.equal(tray.errors[0].label, "Đã lưu");
  assert.equal(tray.errors[0].saved, true);
  assert.equal(tray.vocab[0].saved, true);
  assert.equal(tray.vocab[0].checked, false);
  const fresh = buildTray(result, {});
  assert.deepEqual(fresh.errors.map((r) => r.checked), [true, true, false]);
  assert.equal(fresh.vocab[0].checked, true);
});

test("which card an item folds into: error by signature, then by the same wrong sentence; word by lemma + pos, then a bare captured word", () => {
  const errors = [stored("e1", { signature: "articles:zero-article-uncountable", original: "a" }), stored("e2", { signature: "pending:e2", original: "The technology has changed" }), stored("e3", { signature: "tenses:x", original: "z", deleted: true })];
  assert.equal(findExistingError(errors, err()).id, "e1"); // signature wins over the same sentence
  assert.equal(findExistingError(errors, err({ signature: "articles:other" })).id, "e2"); // same wrong sentence, still pending
  assert.equal(findExistingError(errors, err({ original: "zzz", signature: "tenses:x", type: "tenses" })), undefined); // a deleted card does not count
  const vocab = [stored("v1", { lemma: "mitigate", word: "mitigate", pos: "verb" }), stored("v2", { lemma: "scarce", word: "scarce", pos: "" }), stored("v3", { lemma: "gone", word: "gone", pos: "verb", deleted: true })];
  assert.equal(findExistingVocab(vocab, "Mitigate", "verb").id, "v1");
  assert.equal(findExistingVocab(vocab, "scarce", "adjective").id, "v2"); // the learner's own bare card is the one to complete
  assert.equal(findExistingVocab(vocab, "mitigate", "noun"), undefined);
  assert.equal(findExistingVocab(vocab, "gone", "verb"), undefined);
});

// ---- picker ----
test("picker: pieces finished on the practice screen, analysed ones and ones typed here; not empty or unfinished practice drafts", () => {
  const subs = [
    stored("a", { kind: "writing", text: "x", doneAt: "2026-02-01", updatedAt: "2026-02-01", wordCount: 5, source: { book: 15, test: 1, task: 2 } }),
    stored("b", { kind: "writing", text: "y", status: "draft", updatedAt: "2026-02-02" }), // unfinished practice draft
    stored("c", { kind: "writing", text: "z", origin: "studio", updatedAt: "2026-02-03" }),
    stored("d", { kind: "speaking", text: "s", origin: "studio", updatedAt: "2026-02-04" }),
    stored("e", { kind: "writing", text: "", origin: "studio", updatedAt: "2026-02-05" }),
    stored("f", { kind: "writing", text: "w", status: "analyzed", updatedAt: "2026-02-06" }),
  ];
  assert.deepEqual(pickerSubmissions(subs, "writing").map((s) => s.id), ["f", "c", "a"]);
  assert.deepEqual(pickerSubmissions(subs, "speaking").map((s) => s.id), ["d"]);
  assert.equal(submissionLabel(subs[0]), "Cam 15 · Test 1 · Task 2 · 5 từ · Đã viết");
  assert.match(submissionLabel({ kind: "speaking", source: { part: 2 }, wordCount: 80, status: "analyzed" }), /Part 2 · 80 từ · Đã phân tích/);
  assert.equal(taskFor("writing", 1), "writing_task1");
  assert.equal(taskFor("writing", 2), "writing_task2");
  assert.equal(taskFor("speaking", 1), "speaking");
});

// ---- prompts ----
const input = (extra = {}) => ({ questionText: "Some people think X. Discuss.", text: "My essay text here.", wordCount: 4, taskType: "Opinion (agree / disagree)", part: null, signatures: ["articles:zero-article-uncountable", "tenses:present-perfect", "articles:zero-article-uncountable"], ...extra });

test("every analysis prompt: minimal correction, separate band7Text, signature list, no invented sources, Vietnamese, JSON only", () => {
  for (const task of ["writing_task1", "writing_task2", "speaking"]) {
    const p = buildAnalysisPrompt(task, input({ part: 2 }));
    assert.match(p, /ONE JSON object and nothing else/);
    assert.match(p, /MINIMAL correction/);
    assert.match(p, /"band7Text"/);
    assert.match(p, /Existing signatures \(2\)/);
    assert.match(p, /"articles:zero-article-uncountable"/);
    assert.match(p, /Do not invent sources/);
    assert.match(p, /Band 8 model answer/);
    assert.match(p, /in Vietnamese/);
    assert.match(p, /average of the four criteria, rounded to the nearest 0\.5/);
    assert.match(p, /at most 2 times/);
    for (const c of CRITERIA[task]) assert.match(p, new RegExp(`"${c}"`));
    assert.match(p, /<<<BEGIN>>>\nMy essay text here\.\n<<<END>>>/);
    assert.match(p, /Some people think X/);
  }
});

test("Task 1 prompt: the learner attaches an image, no guessing figures, the exact sentence for the missing image, dataAccuracyChecked", () => {
  const p = buildAnalysisPrompt("writing_task1", input());
  assert.match(p, /ATTACH the chart/);
  assert.match(p, /không kiểm tra được độ chính xác số liệu/);
  assert.match(p, /do not guess any figures/);
  assert.match(p, /"dataAccuracyChecked"/);
  const t2 = buildAnalysisPrompt("writing_task2", input());
  assert.ok(!/ATTACH|dataAccuracyChecked/.test(t2));
});

test("Speaking prompt: the transcript is typed, real pronunciation cannot be assessed, P is an estimate stated in the feedback", () => {
  const p = buildAnalysisPrompt("speaking", input({ part: 3 }));
  assert.match(p, /typed the transcript/);
  assert.match(p, /cannot hear the learner/);
  assert.match(p, /ESTIMATE/);
  assert.match(p, /Speaking Part 3/);
  assert.ok(!/ATTACH/.test(p));
});

test("prompts carry only what the learner typed: no book or test names, no progress", () => {
  const p = buildAnalysisPrompt("writing_task2", input());
  assert.ok(!/Cam \d|Cambridge \d|"box"|Test \d/.test(p.replace(/Do not (invent sources[^\n]*)/, "")));
});

test("buildAnalysisPrompt refuses empty text and unknown tasks; startTask gives a session that parses the answer", () => {
  assert.throws(() => buildAnalysisPrompt("writing_task2", input({ text: "  " })), /Chưa có nội dung/);
  assert.throws(() => buildAnalysisPrompt("vocab_enrich", input()), /chưa hỗ trợ/);
  const session = startTask("writing_task2", input());
  assert.equal(session.mode, "manual");
  assert.match(session.prompt, /writing_task2/);
  assert.equal(session.accept(JSON.stringify(answer("writing_task2"))).task, "writing_task2");
  assert.throws(() => session.accept(JSON.stringify(answer("speaking"))), AiFormatError);
  assert.throws(() => session.accept("không phải JSON"), /Không thấy JSON/);
});
