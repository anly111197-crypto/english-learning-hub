import test from "node:test";
import assert from "node:assert/strict";
import {
  pickBatch, pendingCount, vocabPromptItems, errorPromptItems, knownSignatures, buildVocabRows, buildErrorRows,
  findVocabConflict, findErrorConflict, validateVocabValues, validateErrorValues, vocabFieldsToSave, errorFieldsToSave,
} from "../js/services/enrich.js";
import { mergeVocabFields } from "../js/services/vocab-merge.js";
import { mergeErrorFields } from "../js/services/errors.js";

const word = (id, lemma, extra = {}) => ({ id, word: lemma, lemma, pos: "", createdAt: `2026-01-${String(id.replace(/\D/g, "") || 1).padStart(2, "0")}T00:00:00Z`, enriched: false, collocations: [], contexts: [], box: 1, ...extra });
const err = (id, original, extra = {}) => ({ id, original, signature: `pending:${id}`, createdAt: `2026-01-${String(id.replace(/\D/g, "") || 1).padStart(2, "0")}T00:00:00Z`, enriched: false, occurrences: 1, ...extra });

test("pickBatch: at most 20, oldest first, only items still waiting, live only", () => {
  const records = Array.from({ length: 25 }, (_, i) => word(`w${i + 1}`, `word${i + 1}`));
  records[0].enriched = true;
  records[1].deleted = true;
  const batch = pickBatch(records);
  assert.equal(batch.length, 20);
  assert.deepEqual(batch.slice(0, 2).map((r) => r.id), ["w3", "w4"]);
  assert.ok(batch.every((r) => !r.enriched && !r.deleted));
  assert.equal(pendingCount(records), 23);
});

test("pickBatch with a selection: exactly those, even when already completed, capped at 20", () => {
  const records = [word("w1", "a", { enriched: true }), word("w2", "b"), word("w3", "c")];
  assert.deepEqual(pickBatch(records, { selectedIds: ["w1", "w3", "nope"] }).map((r) => r.id), ["w1", "w3"]);
  const many = Array.from({ length: 30 }, (_, i) => word(`w${i + 1}`, `x${i}`));
  assert.equal(pickBatch(many, { selectedIds: many.map((r) => r.id) }).length, 20);
});

test("prompt items carry only what the learner typed (latest context sentence, no source, no box)", () => {
  const v = word("w1", "mitigate", { box: 4, contexts: [{ sentence: "old one", source: { book: 15 } }, { sentence: "newest one", source: { book: 16 } }] });
  const [item] = vocabPromptItems([v]);
  assert.deepEqual(item, { id: "w1", word: "mitigate", context: "newest one" });
  assert.deepEqual(vocabPromptItems([word("w2", "x")])[0], { id: "w2", word: "x", context: "" });
  assert.deepEqual(errorPromptItems([err("e1", "I has", { corrected: " I have " })])[0], { id: "e1", original: "I has", corrected: "I have" });
});

test("knownSignatures: live, real signatures only, no duplicates", () => {
  const errors = [err("e1", "a"), err("e2", "b", { signature: "articles:zero" }), err("e3", "c", { signature: "Articles:zero" }), err("e4", "d", { signature: "tenses:x", deleted: true })];
  assert.deepEqual(knownSignatures(errors), ["articles:zero"]);
});

test("rows follow the batch order and carry what the card already holds", () => {
  const batch = [word("w1", "recieve", { meaningVi: "nhận", collocations: ["receive a letter"] }), word("w2", "mitigate")];
  const items = [{ id: "w2", lemma: "mitigate", pos: "verb", ipa: "/x/", meaningVi: "giảm", collocations: [], example: "", wordFamily: [], noteVi: "" }, { id: "w1", lemma: "receive", pos: "verb", ipa: "/y/", meaningVi: "nhận được", collocations: ["receive a call"], example: "", wordFamily: [], noteVi: "Bạn gõ sai chính tả." }];
  const rows = buildVocabRows(batch, items);
  assert.deepEqual(rows.map((r) => r.id), ["w1", "w2"]);
  assert.equal(rows[0].noteVi, "Bạn gõ sai chính tả.");
  assert.equal(rows[0].have.meaningVi, "nhận");
  assert.deepEqual(rows[0].have.collocations, ["receive a letter"]);
  assert.equal(buildVocabRows(batch, [items[0]]).length, 1); // an item Claude skipped has no row
  const errRows = buildErrorRows([err("e1", "I has")], [{ id: "e1", type: "tenses", signature: "tenses:x", corrected: "I have", explanationVi: "...", correctExample: "" }]);
  assert.equal(errRows[0].label, "I has");
});

test("vocabFieldsToSave: collocations and word family are added to the old ones; example never touches contexts", () => {
  const cur = word("w1", "mitigate", { collocations: ["mitigate risk"], wordFamily: ["mitigation"], contexts: [{ sentence: "My own sentence.", source: null }] });
  const out = vocabFieldsToSave(cur, { lemma: "Mitigate", pos: "verb", ipa: "/ˈmɪtɪɡeɪt/", meaningVi: " giảm nhẹ ", collocations: ["mitigate the impact", "Mitigate Risk"], example: "Claude's sentence.", wordFamily: ["mitigating"], noteVi: "" });
  assert.equal(out.lemma, "mitigate");
  assert.equal(out.word, "mitigate");
  assert.deepEqual(out.collocations, ["mitigate risk", "mitigate the impact"]);
  assert.deepEqual(out.wordFamily, ["mitigation", "mitigating"]);
  assert.equal(out.exampleEn, "Claude's sentence.");
  assert.ok(!("contexts" in out));
});

test("a misspelling note makes the corrected word the card's word; otherwise the typed word stays", () => {
  const cur = word("w1", "recieve");
  const base = { lemma: "receive", pos: "verb", ipa: "/rɪˈsiːv/", meaningVi: "nhận", collocations: [], example: "", wordFamily: [] };
  assert.equal(vocabFieldsToSave(cur, { ...base, noteVi: "Bạn gõ sai chính tả." }).word, "receive");
  assert.equal(vocabFieldsToSave(word("w2", "mitigating"), { ...base, lemma: "mitigate", noteVi: "" }).word, "mitigating");
});

test("duplicates after completing: another live card with the same lemma + pos, or the same signature", () => {
  const vocab = [word("w1", "mitigate", { pos: "verb" }), word("w2", "mitigate"), word("w3", "gone", { pos: "verb", deleted: true })];
  assert.equal(findVocabConflict(vocab, "w2", "Mitigate", "verb")?.id, "w1");
  assert.equal(findVocabConflict(vocab, "w1", "mitigate", "verb"), undefined); // itself does not count
  assert.equal(findVocabConflict(vocab, "w2", "mitigate", "noun"), undefined);
  assert.equal(findVocabConflict(vocab, "w2", "gone", "verb"), undefined); // a deleted card is not a conflict
  const errors = [err("e1", "a", { signature: "articles:zero" }), err("e2", "b")];
  assert.equal(findErrorConflict(errors, "e2", "Articles:Zero")?.id, "e1");
  assert.equal(findErrorConflict(errors, "e1", "articles:zero"), undefined);
});

test("folding a completed card into an old one keeps the old card's Leitner box, review date and lapses", () => {
  const old = word("w1", "mitigate", { pos: "verb", box: 4, nextReview: "2026-03-01", lapses: 2, meaningVi: "giảm nhẹ", enriched: true, contexts: [{ sentence: "Old sentence.", source: null }] });
  const fresh = word("w2", "mitigate", { box: 1, nextReview: "2026-01-05", lapses: 0, ipa: "/ˈmɪtɪɡeɪt/", meaningVi: "giảm (từ Claude)", collocations: ["mitigate the impact"], exampleEn: "Claude's.", wordFamily: ["mitigation"], contexts: [{ sentence: "New sentence.", source: { book: 15, test: 1, skill: "L", part: 2 } }], enriched: true });
  const merged = mergeVocabFields(old, fresh, { keepProgress: true });
  assert.equal(merged.box, 4);
  assert.equal(merged.nextReview, "2026-03-01");
  assert.equal(merged.lapses, 2);
  assert.equal(merged.meaningVi, "giảm nhẹ"); // the old card's own value wins
  assert.equal(merged.ipa, "/ˈmɪtɪɡeɪt/"); // gaps are filled from the new card
  assert.deepEqual(merged.contexts.map((c) => c.sentence), ["Old sentence.", "New sentence."]);
  assert.deepEqual(merged.collocations, ["mitigate the impact"]);
  assert.deepEqual(merged.wordFamily, ["mitigation"]);
  assert.equal(merged.exampleEn, "Claude's.");
  assert.equal(merged.enriched, true);
});

test("the bank's own 'Gộp' still takes the lower box and the earlier review date", () => {
  const a = word("w1", "x", { box: 4, nextReview: "2026-03-01", lapses: 1 });
  const b = word("w2", "x", { box: 2, nextReview: "2026-02-01", lapses: 1 });
  const m = mergeVocabFields(a, b);
  assert.equal(m.box, 2);
  assert.equal(m.nextReview, "2026-02-01");
  assert.equal(m.lapses, 2);
});

test("folding a completed error into an existing one adds the occurrences and keeps the old card", () => {
  const old = err("e1", "The technology has changed.", { signature: "articles:zero", occurrences: 3, type: "articles", corrected: "Technology has changed.", explanationVi: "cũ", status: "practicing", warmupStreak: 2, enriched: true });
  const fresh = err("e2", "The information is useful.", { occurrences: 1, type: "articles", corrected: "Information is useful.", explanationVi: "mới", correctExample: "Ex.", enriched: true });
  const merged = mergeErrorFields(old, fresh);
  assert.equal(merged.occurrences, 4);
  assert.equal(merged.signature, "articles:zero");
  assert.equal(merged.explanationVi, "cũ");
  assert.equal(merged.correctExample, "Ex.");
  assert.equal(merged.id, "e1");
});

test("validation of the values before saving", () => {
  const ok = { lemma: "mitigate", pos: "verb", meaningVi: "giảm" };
  assert.equal(validateVocabValues(ok), "");
  assert.match(validateVocabValues({ ...ok, lemma: " " }), /lemma/);
  assert.match(validateVocabValues({ ...ok, pos: "x" }), /Loại từ/);
  assert.match(validateVocabValues({ ...ok, meaningVi: "" }), /nghĩa/);
  const e = { type: "articles", signature: "articles:zero", corrected: "x" };
  assert.equal(validateErrorValues(e), "");
  assert.match(validateErrorValues({ ...e, type: "" }), /nhóm/);
  assert.match(validateErrorValues({ ...e, signature: "tenses:x" }), /bắt đầu bằng "articles:"/);
  assert.match(validateErrorValues({ ...e, signature: "articles" }), /nhóm:quy-tắc/);
  assert.match(validateErrorValues({ ...e, corrected: " " }), /câu sửa/);
  assert.deepEqual(errorFieldsToSave({ ...e, signature: " Articles : Zero ", explanationVi: " a ", correctExample: "" }), { type: "articles", signature: "articles:zero", corrected: "x", explanationVi: "a", correctExample: "" });
});
