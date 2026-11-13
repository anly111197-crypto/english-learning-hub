// Prompts for Claude (spec 7.3). Pure text builders: same prompt for copy/paste now and the API in step 9.
// Only what the learner typed goes in (words, their own context sentences, wrong sentences, existing signatures):
// no book/test names, no learning progress.
import { ERROR_TYPES } from "../services/taxonomy.js";
import { AI_SCHEMA_VERSION, POS_VALUES, MAX_ENRICH_BATCH, CRITERIA, CRITERIA_LABELS, ANALYSIS_TASKS } from "./schema.js";

const MAX_SIGNATURES = 200;
const json = (value) => JSON.stringify(value, null, 2);

const COMMON = [
  "You are helping a Vietnamese learner who is preparing for IELTS Academic (target band 6.5-7.0).",
  "Reply with ONE JSON object and nothing else: no greeting, no explanation outside the JSON. A ```json code block is fine.",
  "Every item in your answer must keep the exact \"id\" it was given. Return one item per input item.",
  "Write explanations and meanings in Vietnamese; keep English terms in English.",
];

export function buildVocabEnrichPrompt(items) {
  const input = items.map((i) => ({ id: i.id, word: i.word, ...(i.context ? { context: i.context } : {}) }));
  return [
    ...COMMON,
    "",
    "TASK vocab_enrich: complete these vocabulary cards. The learner typed only the word, often while listening or reading a test, and sometimes with the sentence it appeared in.",
    "",
    "For each item return:",
    '- "id": copy from the input.',
    '- "lemma": dictionary form, lowercase (for a collocation or phrase, the phrase in its base form).',
    `- "pos": one of ${POS_VALUES.join(", ")}.`,
    '- "ipa": IPA with slashes, e.g. "/ˈmɪtɪɡeɪt/".',
    '- "meaningVi": a short Vietnamese meaning. If "context" is given, choose the meaning that fits THAT sentence. With no context, give the meaning most common in IELTS Academic texts.',
    '- "collocations": 2 to 4 useful collocations (array of strings, may be empty).',
    '- "example": ONE short, natural English example sentence you write yourself.',
    '- "wordFamily": related forms such as noun/verb/adjective (array of strings, may be empty).',
    '- "noteVi" (optional): if the typed word looks MISSPELLED (common when typed from listening), put the correct word in "lemma" and explain in Vietnamese in "noteVi" what the learner probably meant. Leave "noteVi" out when the word is fine.',
    "Do not invent sources, do not quote textbooks, and do not mention Cambridge.",
    "",
    "Answer format:",
    json({
      schemaVersion: AI_SCHEMA_VERSION,
      task: "vocab_enrich",
      items: [{ id: "<id>", lemma: "mitigate", pos: "verb", ipa: "/ˈmɪtɪɡeɪt/", meaningVi: "giảm nhẹ", collocations: ["mitigate the impact"], example: "Governments must mitigate the effects of climate change.", wordFamily: ["mitigation (n)"], noteVi: "" }],
    }),
    "",
    `Input (${input.length} item${input.length === 1 ? "" : "s"}):`,
    json(input),
  ].join("\n");
}

export function buildErrorEnrichPrompt(items, signatures = []) {
  const input = items.map((i) => ({ id: i.id, original: i.original, ...(i.corrected ? { learnerCorrection: i.corrected } : {}) }));
  const known = [...new Set(signatures.map((s) => String(s).trim()).filter(Boolean))].slice(0, MAX_SIGNATURES);
  return [
    ...COMMON,
    "",
    "TASK error_enrich: classify these mistakes the learner wrote down and fix them.",
    "",
    "For each item return:",
    '- "id": copy from the input.',
    `- "type": one of ${ERROR_TYPES.map((t) => t.slug).join(", ")}.`,
    '- "signature": "<type>:<rule>" in lowercase kebab-case, e.g. "articles:zero-article-uncountable". The part before the colon must equal "type".',
    '    Choose a signature from the EXISTING list below whenever one describes the same rule. Create a new one only when none matches.',
    '- "corrected": the MINIMAL correction of the sentence: fix only the mistake, keep the learner\'s meaning and words. If "learnerCorrection" is given and is right, use it. Do not upgrade the style.',
    '- "explanationVi": a short explanation in Vietnamese of why it is wrong.',
    '- "correctExample": ONE different, short English sentence showing the same rule used correctly.',
    "Do not invent sources and do not mention Cambridge.",
    "",
    `Existing signatures (${known.length}):`,
    json(known),
    "",
    "Answer format:",
    json({
      schemaVersion: AI_SCHEMA_VERSION,
      task: "error_enrich",
      items: [{ id: "<id>", type: "articles", signature: "articles:zero-article-uncountable", corrected: "Technology has changed.", explanationVi: "...", correctExample: "Information is power." }],
    }),
    "",
    `Input (${input.length} item${input.length === 1 ? "" : "s"}):`,
    json(input),
  ].join("\n");
}

// input: { items, signatures? }
export function buildPrompt(task, input) {
  if (!Array.isArray(input?.items) || input.items.length === 0) throw new Error("Không có mục nào để gửi Claude.");
  if (input.items.length > MAX_ENRICH_BATCH) throw new Error(`Mỗi lần chỉ gửi tối đa ${MAX_ENRICH_BATCH} mục.`);
  if (task === "vocab_enrich") return buildVocabEnrichPrompt(input.items);
  if (task === "error_enrich") return buildErrorEnrichPrompt(input.items, input.signatures);
  throw new Error(`Tác vụ "${task}" chưa hỗ trợ.`);
}

// ---- Writing & Speaking analysis (spec 5.6, 7.3) ----

const TASK_HEADLINE = {
  writing_task1: "assess this IELTS Academic Writing Task 1 report written by the learner",
  writing_task2: "assess this IELTS Academic Writing Task 2 essay written by the learner",
  speaking: "assess this IELTS Speaking answer. The learner typed the transcript themselves from memory or a recording",
};

// input: { questionText, text, wordCount, taskType, part, signatures }. Only what the learner typed goes in.
export function buildAnalysisPrompt(task, input) {
  if (!ANALYSIS_TASKS.includes(task)) throw new Error(`Tác vụ "${task}" chưa hỗ trợ.`);
  if (!String(input?.text ?? "").trim()) throw new Error("Chưa có nội dung để gửi Claude.");
  const criteria = CRITERIA[task];
  const known = [...new Set((input.signatures ?? []).map((s) => String(s).trim()).filter(Boolean))].slice(0, MAX_SIGNATURES);
  const isSpeaking = task === "speaking";
  const isTask1 = task === "writing_task1";
  const unit = isSpeaking ? "transcript" : "text";

  const lines = [
    "You are an experienced IELTS examiner helping a Vietnamese learner whose target is band 6.5-7.0.",
    "Reply with ONE JSON object and nothing else: no greeting, no explanation outside the JSON. A ```json code block is fine.",
    "Write all explanations and feedback in Vietnamese; keep English terms in English.",
    "",
    `TASK ${task}: ${TASK_HEADLINE[task]}.`,
    "",
    `Bands: give "bands" with ${criteria.map((c) => `"${c}" (${CRITERIA_LABELS[c]})`).join(", ")} and "overall". Every band is a number from 0 to 9 in steps of 0.5. Be honest, not generous.`,
    '"overall" must be the average of the four criteria, rounded to the nearest 0.5 (6.25 becomes 6.5, 6.75 becomes 7.0).',
    `Give "criteriaFeedbackVi": one short Vietnamese comment for each of ${criteria.join(", ")}.`,
    "",
    `Give "errors": the real mistakes in the learner's ${unit}, one object each:`,
    '- "original": the wrong words copied EXACTLY (character for character) from the learner\'s text. Keep it short: only the wrong phrase or sentence part.',
    '- "corrected": the MINIMAL correction of that phrase: fix only the mistake, keep the learner\'s meaning and words. Do not upgrade the style here.',
    `- "type": one of ${ERROR_TYPES.map((t) => t.slug).join(", ")}.`,
    '- "signature": "<type>:<rule>" in lowercase kebab-case, e.g. "articles:zero-article-uncountable". The part before the colon must equal "type".',
    "    Choose a signature from the EXISTING list below whenever one describes the same rule. Create a new one only when none matches.",
    '- "explanationVi": a short Vietnamese explanation. "correctExample": one different short English sentence using the rule correctly.',
    '- "severity": "high" (blocks understanding or a repeated basic error), "medium", or "low" (small slip).',
    '- "start" and "end" (optional): 0-based character offsets of "original" in the learner\'s text, end exclusive. Leave them out if you are not sure.',
    'If the same signature occurs many times, list it at most 2 times in "errors" (the clearest examples). Do not list the same mistake again and again.',
    "",
    `"minimalCorrectedText": the learner's whole ${unit} with ONLY the mistakes fixed: same words, same ideas, same order.`,
    `"band7Text": a separate rewrite of the whole ${unit} at band 7.0+ level that keeps the learner's ideas. This is where better wording belongs.`,
    '"vocabularySuggestions": 4 to 8 words or collocations worth learning for this topic (they need not appear in the learner\'s text); each with "word", "lemma", "pos" (' +
      `${POS_VALUES.join(", ")}), "ipa", "meaningVi", "collocations" (array), "example" (one short sentence you write).`,
    "Do not invent sources, do not quote textbooks, and do not present any text as a 'Band 8 model answer'.",
  ];

  if (isTask1) {
    lines.push(
      "",
      "IMAGE: the learner will ATTACH the chart / table / diagram as an image in this conversation. If an image is attached, use it to check every number and the overview, and say so in the TA feedback.",
      'If NO image is attached, do not guess any figures: write exactly "không kiểm tra được độ chính xác số liệu" in the TA feedback, judge only the language and structure, and set "dataAccuracyChecked" to false.',
      'Add "dataAccuracyChecked": true when you checked the figures against an attached image, otherwise false.');
  }
  if (isSpeaking) {
    lines.push(
      "",
      "PRONUNCIATION: you cannot hear the learner, only read a typed transcript. Do not claim to assess real pronunciation.",
      'Give "P" only as an ESTIMATE from the text (for example word choice and stress-related spelling problems) and say clearly in the P feedback that it is an estimate, not a real pronunciation score.',
      "Judge fluency from what the text shows (fillers, repetition, self-corrections, coherence). Spoken English is less formal: do not mark normal contractions or discourse markers as errors.");
  }

  const example = {
    schemaVersion: AI_SCHEMA_VERSION,
    task,
    bands: { overall: 6.0, ...Object.fromEntries(criteria.map((c) => [c, 6.0])) },
    criteriaFeedbackVi: Object.fromEntries(criteria.map((c) => [c, "..."])),
    errors: [{ original: "the technology has changed", corrected: "technology has changed", type: "articles", signature: "articles:zero-article-uncountable", explanationVi: "...", correctExample: "...", severity: "medium", start: 112, end: 138 }],
    minimalCorrectedText: "...",
    band7Text: "...",
    vocabularySuggestions: [{ word: "mitigate", lemma: "mitigate", pos: "verb", ipa: "/ˈmɪtɪɡeɪt/", meaningVi: "...", collocations: ["mitigate the impact"], example: "..." }],
    ...(isTask1 ? { dataAccuracyChecked: false } : {}),
  };
  lines.push("", `Existing signatures (${known.length}):`, json(known), "", "Answer format:", json(example), "");

  const meta = [isSpeaking ? (input.part ? `IELTS Speaking Part ${input.part}` : "IELTS Speaking") : isTask1 ? "IELTS Academic Writing Task 1" : "IELTS Academic Writing Task 2"];
  if (input.taskType) meta.push(String(input.taskType));
  lines.push(`Task: ${meta.join(" · ")}`);
  lines.push(`Question given to the learner:\n${String(input.questionText ?? "").trim() || "(not provided)"}`);
  lines.push(`Learner's ${unit} (${Number(input.wordCount) || 0} words), between the markers:`, "<<<BEGIN>>>", String(input.text).trim(), "<<<END>>>");
  return lines.join("\n");
}