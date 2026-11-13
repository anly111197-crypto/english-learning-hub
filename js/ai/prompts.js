// Prompts for Claude (spec 7.3). Pure text builders: same prompt for copy/paste now and the API in step 9.
// Only what the learner typed goes in (words, their own context sentences, wrong sentences, existing signatures):
// no book/test names, no learning progress.
import { ERROR_TYPES } from "../services/taxonomy.js";
import { AI_SCHEMA_VERSION, POS_VALUES, MAX_ENRICH_BATCH } from "./schema.js";

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
