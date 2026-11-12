import test from "node:test";
import assert from "node:assert/strict";
import { BOM, csvCell, toCsv, vocabRows, vocabCsv, VOCAB_CSV_HEADER } from "../js/services/csv.js";

test("csvCell quotes commas, quotes and line breaks", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a, b"), '"a, b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
  assert.equal(csvCell(7), "7");
});

test("csvCell stops spreadsheet formulas", () => {
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell("+cmd"), "'+cmd");
  assert.equal(csvCell("@sum"), "'@sum");
  assert.equal(csvCell("-ing"), "'-ing");
  assert.equal(csvCell("a=b"), "a=b");
});

test("toCsv starts with a UTF-8 BOM, uses CRLF and keeps Vietnamese text", () => {
  const out = toCsv([["a", "b"], ["đô thị hoá", "c,d"]]);
  assert.equal(out.charCodeAt(0), 0xfeff);
  assert.ok(out.startsWith(BOM + "a,b\r\n"));
  assert.ok(out.endsWith('\r\n'));
  assert.ok(out.includes('đô thị hoá,"c,d"'));
  const bytes = Buffer.from(out, "utf8");
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test("vocabRows: header, collocations joined with '; ', first context and its source", () => {
  const rows = vocabRows([
    {
      word: "mitigate", ipa: "/ˈmɪtɪɡeɪt/", pos: "verb", meaningVi: "giảm nhẹ",
      collocations: ["mitigate the impact", "mitigate risk"],
      contexts: [
        { sentence: "We must mitigate risk.", source: { book: 15, test: 1, skill: "R", part: 2 } },
        { sentence: "Second one.", source: { book: 16, test: 2, skill: "L", part: 1 } },
      ],
    },
    { word: "curb", collocations: [], contexts: [] },
  ]);
  assert.deepEqual(rows[0], VOCAB_CSV_HEADER);
  assert.deepEqual(rows[1], ["mitigate", "/ˈmɪtɪɡeɪt/", "verb", "giảm nhẹ", "mitigate the impact; mitigate risk", "We must mitigate risk.", "Cam 15 · Test 1 · Reading Passage 2"]);
  assert.deepEqual(rows[2], ["curb", "", "", "", "", "", ""]);
});

test("vocabCsv puts it together", () => {
  const out = vocabCsv([{ word: "mitigate, v", contexts: [] }]);
  assert.ok(out.startsWith(BOM + "word,ipa,pos,meaningVi,collocations,context,source\r\n"));
  assert.ok(out.includes('"mitigate, v"'));
});
