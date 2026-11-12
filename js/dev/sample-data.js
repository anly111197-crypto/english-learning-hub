// Dev-only sample data (10 words, 5 errors, 6 attempts). Invented for testing; not Cambridge content.
import { put } from "../services/repo.js";

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const src = (book, test, skill, part) => ({ book, test, skill, part });

const WORDS = [
  ["mitigate", "verb", "giảm nhẹ", "/ˈmɪtɪɡeɪt/", 1],
  ["sustainable", "adjective", "bền vững", "/səˈsteɪnəbl/", 2],
  ["urbanisation", "noun", "đô thị hoá", "/ˌɜːbənaɪˈzeɪʃn/", 3],
  ["alleviate", "verb", "làm dịu bớt", "/əˈliːvieɪt/", 4],
  ["substantial", "adjective", "đáng kể", "/səbˈstænʃl/", 5],
  ["curb", "verb", "kiềm chế", "/kɜːb/", 1],
  ["infrastructure", "noun", "cơ sở hạ tầng", "/ˈɪnfrəstrʌktʃə/", 2],
  ["undermine", "verb", "làm suy yếu", "/ˌʌndəˈmaɪn/", 3],
  ["viable", "adjective", "khả thi", "/ˈvaɪəbl/", 4],
  ["Foster", "verb", "thúc đẩy", "/ˈfɒstə/", 1],
];

// Collocations for the box-5 word (so the "type from a collocation" exercise can appear), and one box-4 word
// without a meaning (it must fall back to a flashcard).
const COLLOCATIONS = { substantial: ["a substantial increase", "substantial evidence"], mitigate: ["mitigate the impact", "mitigate risks"] };
const NO_MEANING = new Set(["viable"]);

const ERRORS = [
  ["articles:zero-article-uncountable", "articles", "the technology has changed", "technology has changed", 3],
  ["collocation:make-research→do-research", "collocations", "make a research", "do research", 2],
  ["subject-verb-agreement:singular-subject", "subject-verb-agreement", "the number of students are rising", "the number of students is rising", 4],
  ["prepositions:depend-on", "prepositions", "it depends of the budget", "it depends on the budget", 1],
  ["tenses:present-perfect-since", "tenses", "I live here since 2020", "I have lived here since 2020", 2],
];

const ATTEMPTS = [
  [15, 1, "L", 7.0, 30], [15, 1, "R", 6.5, 28], [15, 1, "W", 6.0, null],
  [15, 2, "L", 6.5, 27], [15, 2, "R", 7.0, 31], [15, 3, "S", 6.5, null],
];

export async function createSampleData() {
  for (const [i, [word, pos, meaningVi, ipa, box]] of WORDS.entries()) {
    await put("vocab", {
      word, lemma: word.toLowerCase(), pos, ipa, meaningVi: NO_MEANING.has(word) ? "" : meaningVi, definitionEn: "", topic: "environment",
      collocations: COLLOCATIONS[word] ?? [], synonyms: [], box, nextReview: day(box - 2), lapses: 0, enriched: i % 2 === 0,
      contexts: [{ sentence: `Sample sentence ${i + 1} using ${word}.`, source: src(15, (i % 3) + 1, "R", 2), date: day(-i) }],
    });
  }
  for (const [signature, type, original, corrected, occurrences] of ERRORS) {
    await put("errors", {
      signature, type, original, corrected, explanationVi: "Giải thích mẫu.", correctExample: corrected,
      occurrences, firstSeen: day(-20), lastSeen: day(-1), status: "new", warmupStreak: 0, enriched: true,
    });
  }
  for (const [book, test, skill, band, rawScore] of ATTEMPTS) {
    await put("attempts", { book, test, skill, band, rawScore, date: day(-5), durationMin: 60, note: "", ...(skill === "W" ? { task: 2 } : {}) });
  }
  await put("tests", { key: "15-1", book: 15, test: 1, pdfUrl: "", audioUrls: [], pinned: false, note: "" });
}
