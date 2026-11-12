// CSV export that opens correctly in Excel: UTF-8 with BOM, CRLF line ends. Pure functions.
import { sourceLabel } from "./taxonomy.js";

export const BOM = "﻿";
export const VOCAB_CSV_HEADER = ["word", "ipa", "pos", "meaningVi", "collocations", "context", "source"];

export function csvCell(value) {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop Excel from reading text as a formula
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows) {
  return BOM + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// One row per word. `context` and `source` are the first recorded context and its source.
export function vocabRows(words) {
  return [
    VOCAB_CSV_HEADER,
    ...words.map((w) => {
      const first = (w.contexts ?? [])[0];
      return [
        w.word ?? w.lemma ?? "",
        w.ipa ?? "",
        w.pos ?? "",
        w.meaningVi ?? "",
        (w.collocations ?? []).join("; "),
        first?.sentence ?? "",
        first?.source ? sourceLabel(first.source) : "",
      ];
    }),
  ];
}

export const vocabCsv = (words) => toCsv(vocabRows(words));
