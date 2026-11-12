import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDashboard, recentActivity, backupStatus, dateLabel, viDate, TARGET_BAND, ACTIVITY_LIMIT,
} from "../js/services/dashboard-stats.js";
import { indexAttempts, totalDone, averageSummary } from "../js/services/progress.js";
import { summarizeErrors } from "../js/services/errors.js";

const TODAY = "2026-11-12";
let n = 0;
const att = (book, testNo, skill, band, extra = {}) => ({
  id: `a${++n}`, book, test: testNo, skill, band, date: "2026-11-05", updatedAt: "2026-11-05T10:00:00Z", deleted: false, ...extra,
});
const word = (extra = {}) => ({ id: `v${++n}`, word: `w${n}`, box: 1, nextReview: "2026-11-20", enriched: true, deleted: false, ...extra });
const err = (extra = {}) => ({ id: `e${++n}`, original: `wrong ${n}`, corrected: `right ${n}`, type: "articles", status: "new", occurrences: 1, lastSeen: "2026-11-10", warmupStreak: 0, deleted: false, ...extra });
const occ = (itemType, itemId, date, extra = {}) => ({ id: `o${++n}`, itemType, itemId, date, createdAt: `${date}T08:00:00Z`, deleted: false, source: null, ...extra });
const session = (date, warmup, extra = {}) => ({ id: `s${++n}`, date, updatedAt: `${date}T09:00:00Z`, deleted: false, warmup, ...extra });

// ---- empty ----
test("empty database: zeros, no next test history, isEmpty", () => {
  const d = computeDashboard({ today: TODAY });
  assert.equal(d.isEmpty, true);
  assert.deepEqual(d.next, { book: 10, test: 1, reason: "start" });
  assert.deepEqual(d.due, { words: 0, errors: 0 });
  assert.equal(d.warmedToday, false);
  assert.deepEqual([d.progress.done, d.progress.total, d.progress.pct, d.progress.currentBook], [0, 40, 0, null]);
  assert.equal(d.band.overall, null);
  assert.equal(d.band.gap, null);
  assert.equal(d.band.reached, false);
  assert.deepEqual([d.vocab.total, d.vocab.due, d.vocab.pending], [0, 0, 0]);
  assert.deepEqual([d.errors.open, d.errors.top], [0, null]);
  assert.deepEqual(d.activity, []);
  assert.equal(d.vocab.href, "#/vocab");
  assert.equal(d.errors.href, "#/errors?status=open");
});

test("deleted records do not count and do not make the database non-empty", () => {
  const d = computeDashboard({ attempts: [att(15, 1, "L", 7, { deleted: true })], vocab: [word({ deleted: true })], errors: [err({ deleted: true })], today: TODAY });
  assert.equal(d.isEmpty, true);
  assert.equal(d.progress.done, 0);
});

// ---- progress and band ----
test("progress: a test is done with both L and R; current book is the latest attempt's book", () => {
  const attempts = [
    att(15, 1, "L", 7), att(15, 1, "R", 7), att(15, 2, "L", 6.5), att(15, 2, "R", 6.5),
    att(16, 1, "L", 6, { date: "2026-11-10" }), att(16, 1, "W", 6, { task: 2, date: "2026-11-10" }),
  ];
  const d = computeDashboard({ attempts, today: TODAY });
  assert.deepEqual([d.progress.done, d.progress.pct, d.progress.currentBook], [2, 5, 16]);
  assert.equal(d.progress.href, "#/practice");
});

test("band: overall, per skill, gap to 7.0, estimate label data", () => {
  const attempts = [att(15, 1, "L", 7.5), att(15, 1, "R", 6.5), att(15, 1, "W", 6, { task: 2 })];
  const d = computeDashboard({ attempts, today: TODAY });
  assert.equal(d.band.target, TARGET_BAND);
  assert.deepEqual(d.band.skills, { L: 7.5, R: 6.5, W: 6, S: null });
  assert.equal(d.band.overall, 6.5); // (7.5 + 6.5 + 6) / 3 = 6.667
  assert.equal(d.band.count, 3);
  assert.equal(d.band.estimated, true);
  assert.equal(d.band.gap, 0.5);
  assert.equal(d.band.reached, false);
  assert.equal(d.band.pct, 93);
  assert.equal(d.band.href, "#/practice?status=improve");
});

test("band: reached when overall is 7.0 or more; one skill only gives no overall", () => {
  const reached = computeDashboard({ attempts: [att(15, 1, "L", 7.5), att(15, 1, "R", 7.5), att(15, 1, "S", 7), att(15, 1, "W", 7, { task: 2 })], today: TODAY });
  assert.deepEqual([reached.band.overall, reached.band.reached, reached.band.gap, reached.band.estimated, reached.band.pct], [7.5, true, 0, false, 100]);
  const one = computeDashboard({ attempts: [att(15, 1, "L", 7)], today: TODAY });
  assert.deepEqual([one.band.overall, one.band.gap, one.band.reached], [null, null, false]);
});

test("the numbers equal what the other screens compute from the same data", () => {
  const attempts = [att(15, 1, "L", 7), att(15, 1, "R", 6.5), att(15, 2, "L", 6), att(15, 2, "R", 6), att(15, 3, "S", 6.5), att(15, 1, "W", 6.5, { task: 1 })];
  const d = computeDashboard({ attempts, today: TODAY });
  const index = indexAttempts(attempts);
  assert.equal(d.progress.done, totalDone(index));
  const avg = averageSummary(index);
  assert.equal(d.band.overall, avg.overall.value);
  assert.deepEqual(d.band.skills, avg.rounded);
});

// ---- vocabulary and errors ----
test("vocabulary: total, due (today counts), waiting for Claude; the link filters to due words when there are some", () => {
  const vocab = [word({ nextReview: TODAY }), word({ nextReview: "2026-11-01", enriched: false }), word({ nextReview: "2026-11-13" }), word({ enriched: false, deleted: true })];
  const d = computeDashboard({ vocab, today: TODAY });
  assert.deepEqual([d.vocab.total, d.vocab.due, d.vocab.pending], [3, 2, 1]);
  assert.equal(d.vocab.href, "#/vocab?due=1");
  assert.equal(d.due.words, 2);
  assert.equal(computeDashboard({ vocab: [word()], today: TODAY }).vocab.href, "#/vocab");
});

test("errors: open = not fixed; the most frequent group counts open errors only; link carries type and status", () => {
  const errors = [
    err({ type: "tenses" }), err({ type: "tenses", status: "practicing" }),
    err({ type: "articles", status: "fixed" }), err({ type: "articles", status: "fixed" }), err({ type: "articles", status: "fixed" }),
    err({ type: "prepositions", status: "recurring" }),
  ];
  const d = computeDashboard({ errors, today: TODAY });
  assert.deepEqual([d.errors.open, d.errors.fixed, d.errors.total], [3, 3, 6]);
  assert.deepEqual(d.errors.top, { slug: "tenses", label: "Tenses", count: 2 });
  assert.equal(d.errors.href, "#/errors?type=tenses&status=open");
  // same rule as the Grammar Notebook cards, applied to the open errors
  assert.equal(summarizeErrors(errors.filter((e) => e.status !== "fixed"), [], TODAY).top.slug, d.errors.top.slug);
});

test("errors: an unknown group links with type=unknown", () => {
  const d = computeDashboard({ errors: [err({ type: "" })], today: TODAY });
  assert.equal(d.errors.top.slug, "");
  assert.equal(d.errors.href, "#/errors?type=unknown&status=open");
});

test("hero numbers: M errors = errors the warm-up would use (at most 5, with a correct sentence)", () => {
  const errors = Array.from({ length: 8 }, () => err()).concat([err({ corrected: "" })]);
  assert.equal(computeDashboard({ errors, today: TODAY }).due.errors, 5);
  assert.equal(computeDashboard({ errors: [err({ corrected: "" }), err({ status: "fixed" })], today: TODAY }).due.errors, 0);
});

// ---- warm-up today ----
test("warmedToday: a session today with at least one graded answer", () => {
  assert.equal(computeDashboard({ sessions: [session(TODAY, { vocabTotal: 1, errorsTotal: 0 })], today: TODAY }).warmedToday, true);
  assert.equal(computeDashboard({ sessions: [session(TODAY, { vocabTotal: 0, errorsTotal: 2 })], today: TODAY }).warmedToday, true);
  assert.equal(computeDashboard({ sessions: [session(TODAY, { vocabTotal: 0, errorsTotal: 0 })], today: TODAY }).warmedToday, false);
  assert.equal(computeDashboard({ sessions: [session("2026-11-11", { vocabTotal: 5, errorsTotal: 5 })], today: TODAY }).warmedToday, false);
  assert.equal(computeDashboard({ sessions: [session(TODAY, { vocabTotal: 5 }, { deleted: true })], today: TODAY }).warmedToday, false);
});

test("next test and its reason come from next-test (pinned wins)", () => {
  const d = computeDashboard({ attempts: [att(15, 1, "L", 7)], tests: [{ key: "12-3", book: 12, test: 3, pinned: true, deleted: false, updatedAt: "2026-11-01T00:00:00Z" }], today: TODAY });
  assert.deepEqual(d.next, { book: 12, test: 3, reason: "pinned" });
  assert.deepEqual(computeDashboard({ attempts: [att(15, 1, "L", 7)], today: TODAY }).next, { book: 15, test: 1, reason: "continue" });
});

// ---- dates and activity ----
test("dateLabel: today, yesterday, then dd/mm/yyyy", () => {
  assert.equal(dateLabel("2026-11-12", TODAY), "Hôm nay");
  assert.equal(dateLabel("2026-11-11", TODAY), "Hôm qua");
  assert.equal(dateLabel("2026-11-05", TODAY), "05/11/2026");
  assert.equal(dateLabel("2026-10-31", "2026-11-01"), "Hôm qua"); // across a month end
  assert.equal(viDate("2026-01-09"), "09/01/2026");
});

test("activity: attempts show test, skill, score and a link to the test", () => {
  const items = recentActivity({ attempts: [att(15, 1, "R", 7, { rawScore: 31 }), att(15, 1, "W", 6, { task: 2 }), att(15, 2, "S", 6.5)] }, TODAY);
  const byTitle = Object.fromEntries(items.map((i) => [i.title, i]));
  assert.equal(byTitle["Cam 15 · Test 1 · Reading"].detail, "31/40 · Band 7.0");
  assert.equal(byTitle["Cam 15 · Test 1 · Writing Task 2"].detail, "Band 6.0");
  assert.equal(byTitle["Cam 15 · Test 2 · Speaking"].detail, "Band 6.5");
  assert.equal(byTitle["Cam 15 · Test 1 · Reading"].href, "#/practice/15/1");
  assert.equal(byTitle["Cam 15 · Test 1 · Reading"].dateLabel, "05/11/2026");
});

test("activity: warm-up sessions with graded answers, link to the warm-up", () => {
  const items = recentActivity({ sessions: [session(TODAY, { vocabTotal: 10, vocabCorrect: 6, errorsTotal: 5, errorsCorrect: 3 }), session(TODAY, { vocabTotal: 0, errorsTotal: 0 })] }, TODAY);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Khởi động");
  assert.equal(items[0].detail, "nhớ 6/10 từ · sửa đúng 3/5 lỗi");
  assert.equal(items[0].href, "#/warmup");
  assert.equal(items[0].dateLabel, "Hôm nay");
  assert.equal(recentActivity({ sessions: [session(TODAY, { vocabTotal: 4, vocabCorrect: 1, errorsTotal: 0, errorsCorrect: 0 })] }, TODAY)[0].detail, "nhớ 1/4 từ");
});

test("activity: quick capture is grouped by day and test and counts each time something was written down", () => {
  const src = { book: 15, test: 1, skill: "R", part: 2 };
  const occs = [
    ...Array.from({ length: 4 }, (_, i) => occ("vocab", `v${i}`, TODAY, { source: src })),
    occ("error", "e1", TODAY, { source: src }), occ("error", "e2", TODAY, { source: src }),
    occ("vocab", "v9", TODAY, { source: { book: 15, test: 2 } }),
    occ("vocab", "v8", "2026-11-11", { source: src }),
    occ("vocab", "vx", TODAY, { source: src, sessionId: "s1" }), // not quick capture
    occ("vocab", "vy", TODAY, { source: src, deleted: true }),
  ];
  const items = recentActivity({ occurrences: occs }, TODAY);
  const main = items.find((i) => i.title === "6 lần ghi (4 từ, 2 lỗi)");
  assert.ok(main);
  assert.equal(main.detail, "Cam 15 Test 1");
  assert.equal(main.href, "#/practice/15/1");
  assert.equal(main.dateLabel, "Hôm nay");
  assert.ok(items.some((i) => i.title === "1 lần ghi (1 từ)" && i.detail === "Cam 15 Test 2"));
  assert.ok(items.some((i) => i.dateLabel === "Hôm qua" && i.title === "1 lần ghi (1 từ)"));
  assert.equal(items.length, 3);
});

test("activity: with no test the link goes to the vocabulary or the errors", () => {
  const onlyWords = recentActivity({ occurrences: [occ("vocab", "v1", TODAY)] }, TODAY)[0];
  assert.deepEqual([onlyWords.detail, onlyWords.href], ["Không gắn test", "#/vocab"]);
  const onlyErrors = recentActivity({ occurrences: [occ("error", "e1", TODAY)] }, TODAY)[0];
  assert.deepEqual([onlyErrors.title, onlyErrors.href], ["1 lần ghi (1 lỗi)", "#/errors"]);
});

test("activity: newest first (date, then time), at most 5", () => {
  const attempts = Array.from({ length: 8 }, (_, i) => att(15, 1, "L", 6, { id: `x${i}`, date: `2026-11-0${i + 1}`, updatedAt: `2026-11-0${i + 1}T10:00:00Z` }));
  const sessions = [session("2026-11-08", { vocabTotal: 1, vocabCorrect: 1, errorsTotal: 0, errorsCorrect: 0 })];
  const items = recentActivity({ attempts, sessions }, TODAY);
  assert.equal(items.length, ACTIVITY_LIMIT);
  assert.deepEqual(items.map((i) => i.date), ["2026-11-08", "2026-11-08", "2026-11-07", "2026-11-06", "2026-11-05"]);
  assert.deepEqual(items.slice(0, 2).map((i) => i.kind), ["attempt", "warmup"]); // same day: the attempt (10:00) is newer than the session (09:00)
});

test("activity items are included in computeDashboard", () => {
  const d = computeDashboard({ attempts: [att(15, 1, "L", 7)], occurrences: [occ("vocab", "v1", TODAY)], today: TODAY });
  assert.equal(d.activity.length, 2);
  assert.equal(d.isEmpty, false);
});

// ---- backup reminder ----
test("backupStatus: never backed up", () => {
  assert.deepEqual(backupStatus({ hasData: true, today: TODAY }), { text: "Sao lưu lần cuối: chưa sao lưu lần nào", level: "warn" });
  assert.deepEqual(backupStatus({ hasData: false, today: TODAY }), { text: "", level: "none" });
});

test("backupStatus: today, a few days ago, and the warning rule (> 3 days AND newer data)", () => {
  const at = (day, hour = 12) => new Date(2026, 10, day, hour, 0, 0).toISOString(); // local time
  assert.deepEqual(backupStatus({ lastBackupAt: at(12), hasData: true, hasNewData: true, today: TODAY }), { text: "Sao lưu lần cuối: hôm nay", level: "ok" });
  assert.deepEqual(backupStatus({ lastBackupAt: at(10), hasData: true, hasNewData: true, today: TODAY }), { text: "Sao lưu lần cuối: 2 ngày trước", level: "ok" });
  assert.equal(backupStatus({ lastBackupAt: at(9), hasData: true, hasNewData: true, today: TODAY }).level, "ok"); // exactly 3 days
  assert.deepEqual(backupStatus({ lastBackupAt: at(8), hasData: true, hasNewData: true, today: TODAY }), { text: "Sao lưu lần cuối: 4 ngày trước", level: "warn" });
  assert.equal(backupStatus({ lastBackupAt: at(1), hasData: true, hasNewData: false, today: TODAY }).level, "ok"); // old but nothing new
  assert.equal(backupStatus({ lastBackupAt: "not a date", hasData: true, hasNewData: true, today: TODAY }).level, "none");
});
