import test from "node:test";
import assert from "node:assert/strict";
import { mergeData, planImport, validateBackup, findUniqueConflicts, BackupError, TOMBSTONE_MAX_AGE_MS } from "../js/services/merge.js";
import { STORE_NAMES, APP_ID, SCHEMA_VERSION } from "../js/services/schema.js";

const NOW = Date.parse("2026-11-12T00:00:00Z");
const opts = { now: NOW };

const empty = () => Object.fromEntries(STORE_NAMES.map((s) => [s, []]));
const data = (patch) => ({ ...empty(), ...patch });
const rec = (id, updatedAt, extra = {}) => ({ id, createdAt: "2026-01-01T00:00:00Z", updatedAt, deleted: false, ...extra });
const word = (id, updatedAt, extra = {}) => rec(id, updatedAt, { lemma: "mitigate", pos: "verb", meaningVi: "giảm nhẹ", contexts: [], box: 1, ...extra });
const err = (id, updatedAt, extra = {}) => rec(id, updatedAt, { signature: "articles:zero-article-uncountable", occurrences: 1, ...extra });
const file = (d, over = {}) => ({ app: APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt: "2026-11-12T00:00:00Z", data: d, ...over });

test("record only in incoming is added", () => {
  const out = mergeData(data({ attempts: [rec("a1", "2026-02-01T00:00:00Z")] }), data({ attempts: [rec("a2", "2026-02-02T00:00:00Z")] }), opts);
  assert.deepEqual(out.attempts.map((r) => r.id).sort(), ["a1", "a2"]);
});

test("incoming older than local: local is kept", () => {
  const out = mergeData(
    data({ attempts: [rec("a1", "2026-03-01T00:00:00Z", { band: 7 })] }),
    data({ attempts: [rec("a1", "2026-02-01T00:00:00Z", { band: 5 })] }), opts);
  assert.equal(out.attempts.length, 1);
  assert.equal(out.attempts[0].band, 7);
});

test("incoming newer than local: incoming wins", () => {
  const out = mergeData(
    data({ attempts: [rec("a1", "2026-02-01T00:00:00Z", { band: 5 })] }),
    data({ attempts: [rec("a1", "2026-03-01T00:00:00Z", { band: 7 })] }), opts);
  assert.equal(out.attempts[0].band, 7);
});

test("equal updatedAt keeps local", () => {
  const out = mergeData(
    data({ attempts: [rec("a1", "2026-02-01T00:00:00Z", { band: 5 })] }),
    data({ attempts: [rec("a1", "2026-02-01T00:00:00Z", { band: 7 })] }), opts);
  assert.equal(out.attempts[0].band, 5);
});

test("tombstone: newer delete wins, older delete loses", () => {
  // Dates are within 90 days of NOW so the tombstone cleanup does not apply here.
  const newerDelete = mergeData(
    data({ attempts: [rec("a1", "2026-10-01T00:00:00Z")] }),
    data({ attempts: [rec("a1", "2026-10-20T00:00:00Z", { deleted: true })] }), opts);
  assert.equal(newerDelete.attempts[0].deleted, true);

  const olderDelete = mergeData(
    data({ attempts: [rec("a1", "2026-10-20T00:00:00Z")] }),
    data({ attempts: [rec("a1", "2026-10-01T00:00:00Z", { deleted: true })] }), opts);
  assert.equal(olderDelete.attempts[0].deleted, false);
});

test("tombstone older than 90 days is dropped, recent one is kept", () => {
  const old = new Date(NOW - TOMBSTONE_MAX_AGE_MS - 86400000).toISOString();
  const recent = new Date(NOW - 86400000).toISOString();
  const out = mergeData(
    data({ attempts: [rec("old", old, { deleted: true }), rec("new", recent, { deleted: true })] }), data(), opts);
  assert.deepEqual(out.attempts.map((r) => r.id), ["new"]);
});

test("same lemma+pos under different ids: one record, contexts joined without duplicates", () => {
  const c1 = { sentence: "We must mitigate risk.", source: { book: 15, test: 3 } };
  const c2 = { sentence: "Trees mitigate noise.", source: { book: 16, test: 1 } };
  const local = data({ vocab: [word("v-local", "2026-02-01T00:00:00Z", { createdAt: "2026-01-02T00:00:00Z", contexts: [c1] })] });
  const incoming = data({ vocab: [word("v-in", "2026-03-01T00:00:00Z", { createdAt: "2026-01-05T00:00:00Z", lemma: " Mitigate ", contexts: [c1, c2], meaningVi: "làm dịu" })] });
  const out = mergeData(local, incoming, opts);
  assert.equal(out.vocab.length, 1);
  assert.equal(out.vocab[0].id, "v-local"); // earliest created keeps its identity
  assert.equal(out.vocab[0].meaningVi, "làm dịu"); // newest fields win
  assert.equal(out.vocab[0].updatedAt, "2026-03-01T00:00:00Z");
  assert.deepEqual(out.vocab[0].contexts, [c1, c2]);
});

test("same signature under different ids: occurrences added, references re-pointed", () => {
  const local = data({
    errors: [err("e1", "2026-02-01T00:00:00Z", { occurrences: 2, firstSeen: "2026-01-10", lastSeen: "2026-02-01" })],
    occurrences: [{ id: "o1", itemType: "error", itemId: "e1", updatedAt: "2026-02-01T00:00:00Z", deleted: false }],
  });
  const incoming = data({
    errors: [err("e2", "2026-03-01T00:00:00Z", { createdAt: "2026-02-15T00:00:00Z", occurrences: 3, firstSeen: "2026-02-20", lastSeen: "2026-03-01" })],
    occurrences: [{ id: "o2", itemType: "error", itemId: "e2", updatedAt: "2026-03-01T00:00:00Z", deleted: false }],
    exercises: [rec("x1", "2026-03-01T00:00:00Z", { errorIds: ["e2"] })],
  });
  const out = mergeData(local, incoming, opts);
  assert.equal(out.errors.length, 1);
  assert.equal(out.errors[0].id, "e1");
  assert.equal(out.errors[0].occurrences, 5);
  assert.equal(out.errors[0].firstSeen, "2026-01-10");
  assert.equal(out.errors[0].lastSeen, "2026-03-01");
  assert.deepEqual(out.occurrences.map((o) => o.itemId), ["e1", "e1"]);
  assert.deepEqual(out.exercises[0].errorIds, ["e1"]);
});

test("tests store merges by key, not id", () => {
  const out = mergeData(
    data({ tests: [{ key: "15-3", book: 15, test: 3, pdfUrl: "old", updatedAt: "2026-02-01T00:00:00Z", deleted: false }] }),
    data({ tests: [
      { key: "15-3", book: 15, test: 3, pdfUrl: "new", updatedAt: "2026-03-01T00:00:00Z", deleted: false },
      { key: "15-4", book: 15, test: 4, updatedAt: "2026-03-01T00:00:00Z", deleted: false },
    ] }), opts);
  assert.equal(out.tests.length, 2);
  assert.equal(out.tests.find((t) => t.key === "15-3").pdfUrl, "new");
});

test("notebooks with the same group: one record, newest updatedAt wins", () => {
  const out = mergeData(
    data({ notebooks: [rec("n1", "2026-02-01T00:00:00Z", { group: "Writing", notebookUrl: "old" })] }),
    data({ notebooks: [rec("n2", "2026-03-01T00:00:00Z", { group: "Writing", notebookUrl: "new", createdAt: "2026-02-10T00:00:00Z" })] }), opts);
  assert.equal(out.notebooks.length, 1);
  assert.equal(out.notebooks[0].notebookUrl, "new");
  assert.equal(out.notebooks[0].id, "n1");
});

test("mergeData does not modify its inputs", () => {
  const local = data({ vocab: [word("v1", "2026-02-01T00:00:00Z")] });
  const incoming = data({ vocab: [word("v2", "2026-03-01T00:00:00Z")] });
  const before = JSON.stringify([local, incoming]);
  mergeData(local, incoming, opts);
  assert.equal(JSON.stringify([local, incoming]), before);
});

test("replace: file with two vocab of the same lemmaPos is rejected with a Vietnamese error, local untouched", () => {
  const local = data({ vocab: [word("keep", "2026-02-01T00:00:00Z", { lemma: "keep", pos: "verb" })] });
  const snapshot = JSON.stringify(local);
  const bad = file(data({ vocab: [word("v1", "2026-02-01T00:00:00Z"), word("v2", "2026-02-02T00:00:00Z", { lemma: "MITIGATE " })] }));
  assert.throws(() => planImport(local, bad, "replace", opts), (e) => {
    assert.ok(e instanceof BackupError);
    assert.match(e.message, /trùng "MITIGATE "|trùng "mitigate"/);
    assert.match(e.message, /không có dữ liệu nào bị thay đổi/i);
    return true;
  });
  assert.equal(JSON.stringify(local), snapshot);
});

test("replace with a valid file returns the file's data; merge mode merges", () => {
  const local = data({ attempts: [rec("a1", "2026-02-01T00:00:00Z")] });
  const f = file(data({ attempts: [rec("a2", "2026-02-02T00:00:00Z")] }));
  assert.deepEqual(planImport(local, f, "replace", opts).attempts.map((r) => r.id), ["a2"]);
  assert.deepEqual(planImport(local, f, "merge", opts).attempts.map((r) => r.id).sort(), ["a1", "a2"]);
});

test("validateBackup rejects foreign, newer and malformed files", () => {
  assert.throws(() => validateBackup({ app: "other", schemaVersion: 2, data: {} }), BackupError);
  assert.throws(() => validateBackup(file(data(), { schemaVersion: SCHEMA_VERSION + 1 })), /mới hơn/);
  assert.throws(() => validateBackup(file({ vocab: [{ lemma: "x" }] })), /thiếu id/);
  assert.throws(() => validateBackup(file({ attempts: [rec("a1", "2026-01-01T00:00:00Z"), rec("a1", "2026-01-02T00:00:00Z")] })), /trùng id/);
  assert.equal(findUniqueConflicts(validateBackup(file(data()))).length, 0);
});
