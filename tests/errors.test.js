import test from "node:test";
import assert from "node:assert/strict";
import {
  statusAfterRecurrence, mergedStatus, mergeErrorFields, pickWarmupErrors, summarizeErrors, filterErrors, sortErrors,
  normalizeType, STATUS_LABELS,
} from "../js/services/errors.js";

const err = (id, extra = {}) => ({
  id, original: `wrong ${id}`, corrected: "", type: "articles", status: "new", occurrences: 1,
  firstSeen: "2026-11-01", lastSeen: "2026-11-10", deleted: false, ...extra,
});
const occ = (itemId, date, extra = {}) => ({ id: `o-${itemId}-${date}-${Math.random()}`, itemType: "error", itemId, date, deleted: false, ...extra });

test("status labels cover the four statuses", () => {
  assert.deepEqual(Object.keys(STATUS_LABELS), ["new", "practicing", "fixed", "recurring"]);
});

test("recurrence: fixed becomes recurring, the others do not change", () => {
  assert.equal(statusAfterRecurrence("fixed"), "recurring");
  assert.equal(statusAfterRecurrence("new"), "new");
  assert.equal(statusAfterRecurrence("practicing"), "practicing");
  assert.equal(statusAfterRecurrence("recurring"), "recurring");
});

test("mergedStatus: fixed + fixed, fixed + open, open + open", () => {
  assert.equal(mergedStatus("fixed", "fixed"), "fixed");
  assert.equal(mergedStatus("fixed", "new"), "recurring"); // it came back
  assert.equal(mergedStatus("new", "fixed"), "new");
  assert.equal(mergedStatus("practicing", "fixed"), "practicing");
  assert.equal(mergedStatus("new", "recurring"), "recurring");
  assert.equal(mergedStatus("recurring", "practicing"), "recurring");
  assert.equal(mergedStatus("practicing", "new"), "new");
  assert.equal(mergedStatus("new", "practicing"), "new");
});

test("mergeErrorFields adds occurrences, widens dates, fills empty fields, keeps the signature", () => {
  const keep = err("a", { signature: "pending:a", occurrences: 2, firstSeen: "2026-11-05", lastSeen: "2026-11-08", corrected: "", explanationVi: "Quy tắc A", enriched: false });
  const drop = err("b", { signature: "articles:zero-article", occurrences: 3, firstSeen: "2026-11-01", lastSeen: "2026-11-10", corrected: "right b", explanationVi: "Quy tắc B", correctExample: "ex", enriched: true, status: "fixed" });
  const m = mergeErrorFields(keep, drop);
  assert.equal(m.occurrences, 5);
  assert.equal(m.firstSeen, "2026-11-01");
  assert.equal(m.lastSeen, "2026-11-10");
  assert.equal(m.corrected, "right b");
  assert.equal(m.explanationVi, "Quy tắc A"); // the kept card's own value wins
  assert.equal(m.correctExample, "ex");
  assert.equal(m.signature, "pending:a");
  assert.equal(m.enriched, false);
  assert.equal(m.status, "new");
  assert.equal(m.id, "a");
});

test("mergeErrorFields: a fixed kept card merged with an open one becomes recurring", () => {
  assert.equal(mergeErrorFields(err("a", { status: "fixed" }), err("b", { status: "new" })).status, "recurring");
});

test("pickWarmupErrors (6.4): not fixed, most occurrences first, then most recent; at most n", () => {
  const errors = [
    err("e1", { occurrences: 2, lastSeen: "2026-11-05" }),
    err("e2", { occurrences: 5, lastSeen: "2026-11-01" }),
    err("e3", { occurrences: 2, lastSeen: "2026-11-09" }),
    err("e4", { occurrences: 9, status: "fixed" }),
    err("e5", { occurrences: 9, deleted: true }),
    err("e6", { occurrences: 1, lastSeen: "2026-11-11", status: "recurring" }),
    err("e7", { occurrences: 1, lastSeen: "2026-11-02" }),
    err("e8", { occurrences: 1, lastSeen: "2026-11-02" }),
  ];
  assert.deepEqual(pickWarmupErrors(errors).map((e) => e.id), ["e2", "e3", "e1", "e6", "e7"]);
  assert.deepEqual(pickWarmupErrors(errors, 2).map((e) => e.id), ["e2", "e3"]);
  assert.deepEqual(pickWarmupErrors(errors, 10).map((e) => e.id), ["e2", "e3", "e1", "e6", "e7", "e8"]);
  assert.deepEqual(pickWarmupErrors([]), []);
});

test("pickWarmupErrors does not change its input", () => {
  const errors = [err("b", { occurrences: 1 }), err("a", { occurrences: 3 })];
  pickWarmupErrors(errors);
  assert.deepEqual(errors.map((e) => e.id), ["b", "a"]);
});

test("summarizeErrors: totals, top group (with share), fixed share", () => {
  const errors = [
    err("1", { type: "articles", occurrences: 3 }), err("2", { type: "articles", occurrences: 1, status: "fixed" }),
    err("3", { type: "tenses", occurrences: 2 }), err("4", { type: "", occurrences: 1 }),
    err("5", { type: "nonsense", occurrences: 1 }), err("6", { type: "tenses", deleted: true }),
  ];
  const s = summarizeErrors(errors, [], "2026-11-12");
  assert.equal(s.total, 5);
  assert.equal(s.totalOccurrences, 8);
  assert.deepEqual(s.byType, { articles: 2, tenses: 1, "": 2 });
  assert.equal(s.typesUsed, 3);
  assert.deepEqual(s.top, { slug: "articles", label: "Articles", count: 2, share: 40 });
  assert.equal(s.fixed, 1);
  assert.equal(s.fixedPct, 20);
});

test("summarizeErrors: ties go to the earlier group of spec 6.7; no errors gives zeros", () => {
  const tie = summarizeErrors([err("1", { type: "tenses" }), err("2", { type: "articles" })], [], "2026-11-12");
  assert.equal(tie.top.slug, "tenses"); // Tenses is listed before Articles
  const none = summarizeErrors([], [], "2026-11-12");
  assert.deepEqual([none.total, none.top, none.fixedPct, none.alarm], [0, null, 0, 0]);
});

test("alarm: >= 3 encounters within the last 14 days (today and 13 days back), not fixed", () => {
  const errors = [err("in"), err("out"), err("two"), err("fixed", { status: "fixed" }), err("edge")];
  const occs = [
    occ("in", "2026-11-12"), occ("in", "2026-11-10"), occ("in", "2026-11-02"), // 02/11 = today - 10: inside
    occ("out", "2026-11-12"), occ("out", "2026-11-11"), occ("out", "2026-10-29"), // 29/10 = today - 14: outside
    occ("two", "2026-11-12"), occ("two", "2026-11-11"),
    occ("fixed", "2026-11-12"), occ("fixed", "2026-11-11"), occ("fixed", "2026-11-10"),
    occ("edge", "2026-10-30"), occ("edge", "2026-11-01"), occ("edge", "2026-11-12"), // 30/10 = today - 13: inside
    occ("in", "2026-11-13"), // in the future: not counted
    occ("two", "2026-11-09", { deleted: true }), occ("two", "2026-11-08", { itemType: "vocab" }),
  ];
  assert.equal(summarizeErrors(errors, occs, "2026-11-12").alarm, 2); // "in" and "edge"
});

test("filterErrors: by type (including unknown), status and search text without diacritics", () => {
  const errors = [
    err("1", { type: "articles", original: "I like the music", explanationVi: "Không dùng mạo từ" }),
    err("2", { type: "", original: "He go home", status: "fixed" }),
    err("3", { type: "tenses", original: "She go", status: "recurring" }),
    err("4", { type: "articles", deleted: true }),
  ];
  assert.deepEqual(filterErrors(errors).map((e) => e.id), ["1", "2", "3"]);
  assert.deepEqual(filterErrors(errors, { type: "articles" }).map((e) => e.id), ["1"]);
  assert.deepEqual(filterErrors(errors, { type: "" }).map((e) => e.id), ["2"]);
  assert.deepEqual(filterErrors(errors, { status: "recurring" }).map((e) => e.id), ["3"]);
  assert.deepEqual(filterErrors(errors, { status: "all" }).length, 3);
  assert.deepEqual(filterErrors(errors, { status: "open" }).map((e) => e.id), ["1", "3"]); // everything except fixed
  assert.deepEqual(filterErrors(errors, { status: "open", type: "tenses" }).map((e) => e.id), ["3"]);
  assert.deepEqual(filterErrors(errors, { q: "MAO TU" }).map((e) => e.id), ["1"]);
  assert.deepEqual(filterErrors(errors, { q: "go", type: "tenses" }).map((e) => e.id), ["3"]);
  assert.equal(normalizeType("zzz"), "");
});

test("sortErrors: by occurrences or by most recent; returns a new array", () => {
  const errors = [
    err("a", { occurrences: 1, lastSeen: "2026-11-11" }),
    err("b", { occurrences: 4, lastSeen: "2026-11-01" }),
    err("c", { occurrences: 4, lastSeen: "2026-11-05" }),
  ];
  assert.deepEqual(sortErrors(errors, "occurrences").map((e) => e.id), ["c", "b", "a"]);
  assert.deepEqual(sortErrors(errors, "recent").map((e) => e.id), ["a", "c", "b"]);
  assert.deepEqual(errors.map((e) => e.id), ["a", "b", "c"]);
});
