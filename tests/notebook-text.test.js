import test from "node:test";
import assert from "node:assert/strict";
import { parseNotebookText, searchTargets } from "../js/services/notebook-text.js";

test("three labels with colons are split correctly", () => {
  const raw = [
    "KIẾN THỨC: 'Technology' là danh từ không đếm được, không dùng 'the' khi nói chung.",
    "VÍ DỤ: Technology has changed our lives.",
    "NGUỒN: Cambridge Grammar in Use, Unit 70",
  ].join("\n");
  const r = parseNotebookText(raw);
  assert.equal(r.text, "'Technology' là danh từ không đếm được, không dùng 'the' khi nói chung.");
  assert.equal(r.example, "Technology has changed our lives.");
  assert.equal(r.citation, "Cambridge Grammar in Use, Unit 70");
  assert.equal(r.hasLabels, true);
});

test("labels on their own line, with multi-line content", () => {
  const r = parseNotebookText("KIẾN THỨC\nDòng 1\nDòng 2\n\nVÍ DỤ\n- Ví dụ A\n- Ví dụ B\n\nNGUỒN\nSách X");
  assert.equal(r.text, "Dòng 1\nDòng 2");
  assert.equal(r.example, "- Ví dụ A\n- Ví dụ B");
  assert.equal(r.citation, "Sách X");
});

test("lower case, no diacritics, bold marks, bullets and dashes are accepted", () => {
  const r = parseNotebookText("**Kiến thức:** Nội dung 1\n**Ví dụ**: Ví dụ 1\n- nguon - Nguồn 1\n* Vi du: ví dụ 2");
  assert.equal(r.text, "Nội dung 1");
  assert.equal(r.example, "Ví dụ 1\nví dụ 2"); // the same label twice appends
  assert.equal(r.citation, "Nguồn 1");
});

test("text before the first label goes to KIẾN THỨC", () => {
  const r = parseNotebookText("Câu mở đầu.\nVí dụ: Một ví dụ\nKiến thức: Phần kiến thức");
  assert.equal(r.text, "Câu mở đầu.\nPhần kiến thức");
  assert.equal(r.example, "Một ví dụ");
});

test("no labels: the whole text goes to KIẾN THỨC", () => {
  const r = parseNotebookText("Chỉ là một đoạn văn.\nCó hai dòng.");
  assert.deepEqual(r, { text: "Chỉ là một đoạn văn.\nCó hai dòng.", example: "", citation: "", hasLabels: false });
});

test("a sentence that merely starts with a label word is not a label", () => {
  const r = parseNotebookText("Nguồn gốc của từ này là tiếng Latin.\nVí dụ minh họa rất nhiều.\nKiến thức nền cần có.");
  assert.equal(r.hasLabels, false);
  assert.equal(r.text, "Nguồn gốc của từ này là tiếng Latin.\nVí dụ minh họa rất nhiều.\nKiến thức nền cần có.");
});

test("decomposed (NFD) Vietnamese letters are handled, CRLF is fine, empty input is empty", () => {
  const r = parseNotebookText("KIẾN THỨC: a\r\nVÍ DỤ: b".normalize("NFD"));
  assert.equal(r.text, "a");
  assert.equal(r.example, "b");
  assert.deepEqual(parseNotebookText(""), { text: "", example: "", citation: "", hasLabels: false });
  assert.deepEqual(parseNotebookText(null), { text: "", example: "", citation: "", hasLabels: false });
});

test("searchTargets finds tests, words and errors; every query word must match", () => {
  const vocab = [{ id: "v1", word: "mitigate", meaningVi: "giảm nhẹ" }, { id: "v2", word: "curb", meaningVi: "kiềm chế", deleted: true }];
  const errors = [{ id: "e1", original: "the technology has changed", corrected: "technology has changed" }];
  const data = { vocab, errors };
  assert.deepEqual(searchTargets("cam 15 test 3", data).map((t) => t.id), ["15-3"]);
  assert.deepEqual(searchTargets("15 3", data).map((t) => t.id), ["15-3"]);
  assert.equal(searchTargets("cam 15", data).filter((t) => t.type === "test").length, 4);
  assert.deepEqual(searchTargets("GIAM NHE", data).map((t) => [t.type, t.id]), [["vocab", "v1"]]);
  assert.deepEqual(searchTargets("technology", data).map((t) => [t.type, t.id]), [["error", "e1"]]);
  assert.deepEqual(searchTargets("curb", data), []); // deleted words are not offered
  assert.deepEqual(searchTargets("   ", data), []);
});
