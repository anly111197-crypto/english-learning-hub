import test from "node:test";
import assert from "node:assert/strict";
import {
  partGroups, partOfQuestion, defaultMinutes, remainingSec, isTimeUp, clampLimit, formatClockSec, durationMinutes,
  countCorrect, countUnmarked, countBlank, draftKey, emptyDraft, parseDraft, hasProgress, loadDraft, saveDraft, clearDraft,
  loadFileNames, saveFileNames, filesKey, classifyFiles, sortByName, trackLabel, driveFileId, drivePreviewUrl,
  countWords, wordStatus, findWritingDraft, pickWritingState,
} from "../js/services/practice-run.js";
import { rawToBand } from "../js/services/bands.js";

const memory = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m,
  };
};

test("questions are grouped by Part (Listening) and Passage (Reading) and cover 1-40 exactly once", () => {
  const l = partGroups("L");
  assert.deepEqual(l.map((g) => [g.from, g.to]), [[1, 10], [11, 20], [21, 30], [31, 40]]);
  const r = partGroups("R");
  assert.deepEqual(r.map((g) => [g.from, g.to]), [[1, 13], [14, 26], [27, 40]]);
  for (const groups of [l, r]) {
    assert.deepEqual(groups.flatMap((g) => g.numbers), Array.from({ length: 40 }, (_, i) => i + 1));
  }
  assert.deepEqual(partGroups("W"), []);
});

test("partOfQuestion finds the Part or Passage of a question", () => {
  assert.equal(partOfQuestion("L", 1), 1);
  assert.equal(partOfQuestion("L", 10), 1);
  assert.equal(partOfQuestion("L", 11), 2);
  assert.equal(partOfQuestion("L", 40), 4);
  assert.equal(partOfQuestion("R", 13), 1);
  assert.equal(partOfQuestion("R", 14), 2);
  assert.equal(partOfQuestion("R", 27), 3);
  assert.equal(partOfQuestion("R", 40), 3);
  assert.equal(partOfQuestion("R", 41), null);
  assert.equal(partOfQuestion("L", 0), null);
});

test("clock: default minutes, remaining time, time up, limit range", () => {
  assert.equal(defaultMinutes("L"), 30);
  assert.equal(defaultMinutes("R"), 60);
  assert.equal(defaultMinutes("W", 1), 20);
  assert.equal(defaultMinutes("W", 2), 40);
  assert.equal(remainingSec(30, 0), 1800);
  assert.equal(remainingSec(30, 1790.4), 10);
  assert.equal(remainingSec(30, 2000), 0);
  assert.equal(isTimeUp(30, 1799), false);
  assert.equal(isTimeUp(30, 1800), true);
  assert.equal(clampLimit("45", 30), 45);
  assert.equal(clampLimit("0", 30), 1);
  assert.equal(clampLimit("999", 30), 180);
  assert.equal(clampLimit("abc", 30), 30);
  assert.equal(formatClockSec(1800), "30:00");
  assert.equal(formatClockSec(61.2), "01:02");
  assert.equal(formatClockSec(-5), "00:00");
  assert.equal(durationMinutes(0), 1);
  assert.equal(durationMinutes(60), 1);
  assert.equal(durationMinutes(61), 2);
  assert.equal(durationMinutes(1700), 29);
});

test("scoring: correct count, unmarked count, and the band the existing table gives", () => {
  const marks = {};
  for (let n = 1; n <= 40; n++) marks[n] = n <= 31;
  assert.equal(countCorrect(marks), 31);
  assert.equal(countUnmarked(marks), 0);
  assert.equal(rawToBand("R", countCorrect(marks)), 7.0); // Reading 31/40 = 7.0 (spec 6.1)
  assert.equal(countCorrect({}), 0);
  assert.equal(countUnmarked({}), 40);
  assert.equal(countUnmarked({ 1: true, 2: false, 5: true }), 37);
  assert.equal(countCorrect(undefined), 0);
  assert.equal(countUnmarked({ 1: true, 99: true }), 39); // question 99 is not one of the 40
  assert.equal(countBlank({ 1: "cat", 2: "  ", 3: "" }), 39); // only question 1 has an answer
  assert.equal(countBlank({}), 40);
});

test("draft: key carries book-test-skill, and the Writing task", () => {
  assert.equal(draftKey(15, 1, "L"), "elh.run.15-1-L");
  assert.equal(draftKey(15, 1, "R"), "elh.run.15-1-R");
  assert.equal(draftKey(15, 1, "W", 1), "elh.run.15-1-W-1");
  assert.equal(draftKey(15, 1, "W"), "elh.run.15-1-W-2");
});

test("draft: saved answers come back after a reload", () => {
  const s = memory();
  const key = draftKey(15, 1, "L");
  const draft = emptyDraft("L");
  draft.answers = { 1: "library", 2: "Tuesday", 40: "B" };
  draft.elapsedSec = 412.5;
  draft.limitMin = 35;
  draft.marks = { 1: true, 2: false };
  draft.phase = "grade";
  assert.equal(saveDraft(s, key, draft), true);
  const back = loadDraft(s, key, "L");
  assert.deepEqual(back.answers, { 1: "library", 2: "Tuesday", 40: "B" });
  assert.equal(back.elapsedSec, 412.5);
  assert.equal(back.limitMin, 35);
  assert.deepEqual(back.marks, { 1: true, 2: false });
  assert.equal(back.phase, "grade");
});

test("draft: untouched draft is not stored, and clearDraft removes it", () => {
  const s = memory();
  const key = draftKey(15, 2, "R");
  assert.equal(hasProgress(emptyDraft("R")), false);
  saveDraft(s, key, emptyDraft("R"));
  assert.equal(s.m.size, 0);
  const d = emptyDraft("R");
  d.answers = { 3: "x" };
  saveDraft(s, key, d);
  assert.equal(s.m.size, 1);
  clearDraft(s, key);
  assert.equal(s.m.size, 0);
  assert.equal(loadDraft(s, key, "R"), null);
});

test("draft: damaged, old or odd data is rejected or cleaned, never thrown", () => {
  assert.equal(parseDraft("{not json", "L"), null);
  assert.equal(parseDraft(null, "L"), null);
  assert.equal(parseDraft('"text"', "L"), null);
  assert.equal(parseDraft([], "L"), null);
  assert.equal(parseDraft({ v: 0, answers: { 1: "a" } }, "L"), null); // other version
  const d = parseDraft({
    v: 1, phase: "grade", answers: { 1: "ok", 0: "no", 41: "no", x: "no", 2: 5 }, marks: { 1: true, 2: "yes", 99: true },
    elapsedSec: -3, limitMin: 9999,
  }, "L");
  assert.deepEqual(d.answers, { 1: "ok" });
  assert.deepEqual(d.marks, { 1: true });
  assert.equal(d.elapsedSec, 0);
  assert.equal(d.limitMin, 180);
  assert.equal(parseDraft({ v: 1, phase: "grade" }, "W").phase, "answer"); // Writing has no grading phase
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.equal(loadDraft(broken, "k", "L"), null);
  assert.equal(saveDraft(broken, "k", Object.assign(emptyDraft("L"), { answers: { 1: "a" } })), false);
  assert.doesNotThrow(() => clearDraft(broken, "k"));
});

test("Writing draft: text beside the clock is kept, and the newer of the two copies wins", () => {
  const s = memory();
  const key = draftKey(15, 1, "W", 2);
  const d = emptyDraft("W", 2);
  d.text = "Some people believe that";
  d.prompt = "Discuss both views.";
  saveDraft(s, key, d);
  const back = loadDraft(s, key, "W", 2);
  assert.equal(back.text, "Some people believe that");
  assert.equal(back.prompt, "Discuss both views.");
  assert.equal(back.limitMin, 40);
  assert.equal(loadDraft(s, draftKey(15, 1, "L"), "L"), null);
  assert.equal(parseDraft({ v: 1, text: "x" }, "L").text, undefined); // only Writing carries text
  assert.equal(parseDraft({ v: 1, text: 5 }, "W").text, "");
  assert.equal(hasProgress(Object.assign(emptyDraft("W"), { text: "  " })), false);
  assert.equal(hasProgress(Object.assign(emptyDraft("W"), { text: "hi" })), true);

  const sub = { text: "db copy", prompt: "db prompt", updatedAt: "2026-11-12T10:00:00.000Z" };
  assert.deepEqual(pickWritingState(null, sub), { text: "db copy", prompt: "db prompt" });
  assert.deepEqual(pickWritingState({ text: "", prompt: "" }, sub), { text: "db copy", prompt: "db prompt" });
  assert.deepEqual(pickWritingState({ text: "local", prompt: "", savedAt: "2026-11-12T10:00:05.000Z" }, null), { text: "local", prompt: "" });
  assert.equal(pickWritingState({ text: "local", prompt: "", savedAt: "2026-11-12T10:00:05.000Z" }, sub).text, "local"); // local is newer
  assert.equal(pickWritingState({ text: "local", prompt: "", savedAt: "2026-11-12T09:59:00.000Z" }, sub).text, "db copy"); // db is newer
  assert.deepEqual(pickWritingState(null, null), { text: "", prompt: "" });
});

test("remembered file names: only names, rejects garbage", () => {
  const s = memory();
  const key = filesKey(15, 1);
  assert.equal(loadFileNames(s, key), null);
  saveFileNames(s, key, { pdf: "Cam15-Test1.pdf", audio: ["T1-P1.mp3", "T1-P2.mp3"] });
  assert.deepEqual(loadFileNames(s, key), { pdf: "Cam15-Test1.pdf", audio: ["T1-P1.mp3", "T1-P2.mp3"] });
  s.setItem(key, "garbage");
  assert.equal(loadFileNames(s, key), null);
  s.setItem(key, JSON.stringify({ pdf: 5, audio: [1, "a.mp3"] }));
  assert.deepEqual(loadFileNames(s, key), { pdf: "", audio: ["a.mp3"] });
});

test("files: one PDF, audio sorted by name in natural order, others ignored", () => {
  const f = (name, type = "") => ({ name, type });
  const picked = classifyFiles([f("Track 10.mp3", "audio/mpeg"), f("Test 1.pdf", "application/pdf"), f("Track 2.mp3", "audio/mpeg"), f("notes.txt", "text/plain"), f("Track 1.m4a")]);
  assert.equal(picked.pdf.name, "Test 1.pdf");
  assert.deepEqual(picked.audio.map((x) => x.name), ["Track 1.m4a", "Track 2.mp3", "Track 10.mp3"]);
  assert.deepEqual(picked.ignored.map((x) => x.name), ["notes.txt"]);
  assert.equal(classifyFiles([f("scan.PDF")]).pdf.name, "scan.PDF"); // by extension when the type is empty
  assert.equal(classifyFiles([]).pdf, null);
  assert.equal(classifyFiles(undefined).audio.length, 0);
  assert.deepEqual(sortByName([f("b2"), f("b10"), f("b1")]).map((x) => x.name), ["b1", "b2", "b10"]);
  assert.equal(trackLabel(0, 4, "a.mp3"), "Part 1 · a.mp3");
  assert.equal(trackLabel(0, 1, "all.mp3"), "all.mp3");
});

test("Drive link -> preview URL, only for drive.google.com file links", () => {
  const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
  assert.equal(driveFileId(`https://drive.google.com/file/d/${id}/view?usp=sharing`), id);
  assert.equal(driveFileId(`https://drive.google.com/file/d/${id}/preview`), id);
  assert.equal(driveFileId(`https://drive.google.com/file/u/1/d/${id}/view`), id);
  assert.equal(driveFileId(`https://drive.google.com/open?id=${id}`), id);
  assert.equal(driveFileId(`https://drive.google.com/uc?export=download&id=${id}`), id);
  assert.equal(driveFileId("https://example.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view"), null);
  assert.equal(driveFileId(`http://drive.google.com/file/d/${id}/view`), null);
  assert.equal(driveFileId("https://drive.google.com/drive/folders/abc"), null);
  assert.equal(driveFileId("not a url"), null);
  assert.equal(driveFileId(""), null);
  assert.equal(drivePreviewUrl(id), `https://drive.google.com/file/d/${id}/preview`);
});

test("Writing: word count, warnings below 150 / 250, unfinished draft lookup", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("   "), 0);
  assert.equal(countWords("one two\nthree\t four  "), 4);
  assert.deepEqual(wordStatus("a ".repeat(140), 1), { words: 140, min: 150, short: 10 });
  assert.deepEqual(wordStatus("a ".repeat(150), 1), { words: 150, min: 150, short: 0 });
  assert.deepEqual(wordStatus("a ".repeat(100), 2), { words: 100, min: 250, short: 150 });
  assert.equal(wordStatus("a ".repeat(250), 2).short, 0);

  const mk = (over) => ({ id: "x", kind: "writing", status: "draft", source: { book: 15, test: 1, task: 2 }, updatedAt: "2026-11-12T08:00:00Z", ...over });
  const subs = [
    mk({ id: "old", updatedAt: "2026-11-10T08:00:00Z" }),
    mk({ id: "new", updatedAt: "2026-11-12T09:00:00Z" }),
    mk({ id: "done", doneAt: "2026-11-12T10:00:00Z", updatedAt: "2026-11-12T10:00:00Z" }),
    mk({ id: "analyzed", status: "analyzed", updatedAt: "2026-11-12T11:00:00Z" }),
    mk({ id: "gone", deleted: true, updatedAt: "2026-11-12T12:00:00Z" }),
    mk({ id: "task1", source: { book: 15, test: 1, task: 1 }, updatedAt: "2026-11-12T12:00:00Z" }),
    mk({ id: "other", source: { book: 15, test: 2, task: 2 }, updatedAt: "2026-11-12T12:00:00Z" }),
    mk({ id: "speaking", kind: "speaking", updatedAt: "2026-11-12T12:00:00Z" }),
  ];
  assert.equal(findWritingDraft(subs, { book: 15, test: 1, task: 2 }).id, "new");
  assert.equal(findWritingDraft(subs, { book: 15, test: 1, task: 1 }).id, "task1");
  assert.equal(findWritingDraft(subs, { book: 16, test: 1, task: 2 }), null);
  assert.equal(findWritingDraft([], { book: 15, test: 1, task: 2 }), null);
  assert.equal(findWritingDraft(undefined, { book: 15, test: 1, task: 2 }), null);
});
