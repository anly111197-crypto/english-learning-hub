import test from "node:test";
import assert from "node:assert/strict";
import { extractJson, parseEnrichResult, AiFormatError, MAX_ENRICH_BATCH } from "../js/ai/schema.js";
import { buildPrompt, buildVocabEnrichPrompt, buildErrorEnrichPrompt } from "../js/ai/prompts.js";
import { startTask } from "../js/ai/index.js";

const vocabItem = (id, extra = {}) => ({ id, lemma: "mitigate", pos: "verb", ipa: "/ˈmɪtɪɡeɪt/", meaningVi: "giảm nhẹ", collocations: ["mitigate the impact"], example: "We must mitigate risk.", wordFamily: ["mitigation (n)"], ...extra });
const errorItem = (id, extra = {}) => ({ id, type: "articles", signature: "articles:zero-article-uncountable", corrected: "Technology has changed.", explanationVi: "Danh từ không đếm được.", correctExample: "Information is power.", ...extra });
const answer = (task, items, extra = {}) => JSON.stringify({ schemaVersion: 1, task, items, ...extra });

test("extractJson: plain, fenced, and with chatter around it", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('Here you go:\n```json\n{"a":2}\n```\nHope it helps'), { a: 2 });
  assert.deepEqual(extractJson('Sure! {"a":3} Done.'), { a: 3 });
});

test("extractJson: empty, no JSON, truncated JSON and arrays are refused in Vietnamese", () => {
  assert.throws(() => extractJson("   "), (e) => e instanceof AiFormatError && /trống/.test(e.message));
  assert.throws(() => extractJson("Xin lỗi, tôi không làm được"), (e) => /Không thấy JSON/.test(e.message));
  assert.throws(() => extractJson('{"items": [{"id": "1"'), (e) => /không đọc được/.test(e.message));
  assert.throws(() => extractJson("[1,2]"), AiFormatError);
});

test("vocab_enrich: a valid answer is normalised (pos aliases, trimmed text, optional fields)", () => {
  const res = parseEnrichResult("vocab_enrich", answer("vocab_enrich", [vocabItem("a", { pos: "V", lemma: "  Mitigate ", noteVi: " Có thể bạn nghe nhầm. " }), vocabItem("b", { example: undefined, wordFamily: undefined, noteVi: undefined })]), ["a", "b"]);
  assert.equal(res.items.length, 2);
  assert.equal(res.items[0].pos, "verb");
  assert.equal(res.items[0].lemma, "Mitigate"); // case is normalised later, when saving
  assert.equal(res.items[0].noteVi, "Có thể bạn nghe nhầm.");
  assert.deepEqual(res.items[1].wordFamily, []);
  assert.equal(res.items[1].example, "");
  assert.deepEqual(res.missingIds, []);
});

test("items Claude did not return are reported as missing, not as an error", () => {
  const res = parseEnrichResult("vocab_enrich", answer("vocab_enrich", [vocabItem("a")]), ["a", "b", "c"]);
  assert.deepEqual(res.missingIds, ["b", "c"]);
});

test("an id that was not sent, a repeated id and a missing id are errors; nothing is returned", () => {
  const ids = ["a", "b"];
  assert.throws(() => parseEnrichResult("vocab_enrich", answer("vocab_enrich", [vocabItem("a"), vocabItem("zzz")]), ids), (e) => /id "zzz" không khớp/.test(e.message) && /Không có gì được lưu/.test(e.message));
  assert.throws(() => parseEnrichResult("vocab_enrich", answer("vocab_enrich", [vocabItem("a"), vocabItem("a")]), ids), (e) => /bị lặp/.test(e.message));
  assert.throws(() => parseEnrichResult("vocab_enrich", answer("vocab_enrich", [{ ...vocabItem("a"), id: undefined }]), ids), (e) => /thiếu id/.test(e.message));
});

test("vocab_enrich: bad pos, missing meaning, missing ipa and non-list collocations are all reported", () => {
  const ids = ["a"];
  const bad = (patch) => parseEnrichResult("vocab_enrich", answer("vocab_enrich", [vocabItem("a", patch)]), ids);
  assert.throws(() => bad({ pos: "pronoun" }), (e) => /pos "pronoun" không hợp lệ/.test(e.message));
  assert.throws(() => bad({ meaningVi: "" }), (e) => /thiếu meaningVi/.test(e.message));
  assert.throws(() => bad({ ipa: undefined }), (e) => /thiếu ipa/.test(e.message));
  assert.throws(() => bad({ collocations: "a, b" }), (e) => /collocations phải là một danh sách/.test(e.message));
  assert.throws(() => bad({ lemma: "" }), (e) => /thiếu lemma/.test(e.message));
});

test("error_enrich: type must be one of the 10 groups and the signature must start with that type", () => {
  const ids = ["e1"];
  const run = (patch) => parseEnrichResult("error_enrich", answer("error_enrich", [errorItem("e1", patch)]), ids);
  assert.equal(run({}).items[0].signature, "articles:zero-article-uncountable");
  assert.throws(() => run({ type: "grammar" }), (e) => /không thuộc 10 nhóm/.test(e.message));
  assert.throws(() => run({ signature: "tenses:past-simple" }), (e) => /phải bắt đầu bằng "articles:"/.test(e.message));
  assert.throws(() => run({ signature: "articles" }), (e) => /nhóm:quy-tắc/.test(e.message));
  assert.throws(() => run({ corrected: "" }), (e) => /thiếu corrected/.test(e.message));
  assert.throws(() => run({ explanationVi: "" }), (e) => /thiếu explanationVi/.test(e.message));
  assert.equal(run({ type: "Articles", signature: "Articles:Zero-Article" }).items[0].signature, "articles:zero-article");
});

test("the wrong task, a wrong schemaVersion, no items and an empty list are refused", () => {
  assert.throws(() => parseEnrichResult("vocab_enrich", answer("error_enrich", [errorItem("a")]), ["a"]), (e) => /không phải "vocab_enrich"/.test(e.message));
  assert.throws(() => parseEnrichResult("vocab_enrich", answer("vocab_enrich", [vocabItem("a")], { schemaVersion: 7 }), ["a"]), (e) => /schemaVersion 7/.test(e.message));
  assert.throws(() => parseEnrichResult("vocab_enrich", JSON.stringify({ schemaVersion: 1, task: "vocab_enrich" }), ["a"]), (e) => /items/.test(e.message));
  assert.throws(() => parseEnrichResult("vocab_enrich", answer("vocab_enrich", []), ["a"]), (e) => /trống/.test(e.message));
});

test("more than 3 problems: the first 3 are shown with a count of the rest", () => {
  const items = ["a", "b", "c", "d", "e"].map((id) => vocabItem(id, { meaningVi: "" }));
  assert.throws(() => parseEnrichResult("vocab_enrich", answer("vocab_enrich", items), ["a", "b", "c", "d", "e"]), (e) => /và 2 lỗi nữa/.test(e.message));
});

test("vocab prompt: ids, words and context go in; context is left out when empty; no book or test names", () => {
  const p = buildVocabEnrichPrompt([{ id: "v1", word: "mitigate", context: "We must mitigate it." }, { id: "v2", word: "recieve", context: "" }]);
  assert.match(p, /"id": "v1"/);
  assert.match(p, /"context": "We must mitigate it\."/);
  assert.match(p, /"word": "recieve"/);
  assert.equal(p.slice(p.indexOf("Input (")).split('"context"').length - 1, 1); // only the item that has one
  assert.match(p, /noteVi/);
  assert.match(p, /MISSPELLED/);
  assert.match(p, /IELTS Academic/);
  assert.ok(!/Cam \d|Cambridge 1\d|Test \d/.test(p.replace(/never mention Cambridge|do not mention Cambridge/gi, "")));
});

test("error prompt: sends the existing signatures, the 10 groups and the minimal-correction rule", () => {
  const p = buildErrorEnrichPrompt([{ id: "e1", original: "The technology has changed.", corrected: "" }, { id: "e2", original: "He go.", corrected: "He goes." }], ["articles:zero-article-uncountable", "tenses:present-perfect", "articles:zero-article-uncountable", "pending:abc"]);
  assert.match(p, /existing signatures \(3\)/i);
  assert.match(p, /"articles:zero-article-uncountable"/);
  assert.match(p, /subject-verb-agreement/);
  assert.match(p, /plurals-countability/);
  assert.match(p, /MINIMAL correction/);
  assert.match(p, /"learnerCorrection": "He goes\."/);
  assert.equal(p.slice(p.indexOf("Input (")).split("learnerCorrection").length - 1, 1);
});

test("buildPrompt refuses an empty batch, a batch over 20 and an unknown task", () => {
  assert.throws(() => buildPrompt("vocab_enrich", { items: [] }));
  const many = Array.from({ length: MAX_ENRICH_BATCH + 1 }, (_, i) => ({ id: `v${i}`, word: "w", context: "" }));
  assert.throws(() => buildPrompt("vocab_enrich", { items: many }), /tối đa 20/);
  assert.throws(() => buildPrompt("exercise_generate", { items: [{ id: "1" }] }), /chưa hỗ trợ/);
});

test("startTask (manual mode): the prompt contains the ids and accept() checks the answer against them", () => {
  const session = startTask("vocab_enrich", { items: [{ id: "v1", word: "mitigate", context: "" }] });
  assert.equal(session.mode, "manual");
  assert.match(session.prompt, /v1/);
  assert.equal(session.accept(answer("vocab_enrich", [vocabItem("v1")])).items.length, 1);
  assert.throws(() => session.accept(answer("vocab_enrich", [vocabItem("other")])), AiFormatError);
});
