// Shared contract with Claude (spec 7.3): task names, limits and the checks on what comes back.
// Pure (no DOM, no IndexedDB, no network). The same checks serve copy/paste mode now and the API mode in step 9.
import { ERROR_TYPES } from "../services/taxonomy.js";

export const AI_SCHEMA_VERSION = 1;
export const TASKS = ["writing_task1", "writing_task2", "speaking", "vocab_enrich", "error_enrich", "exercise_generate", "exercise_grade"];
export const MAX_ENRICH_BATCH = 20;
export const POS_VALUES = ["noun", "verb", "adjective", "adverb", "phrase", "other"];
export const ERROR_TYPE_SLUGS = ERROR_TYPES.map((t) => t.slug);

export class AiFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = "AiFormatError";
  }
}

const POS_ALIASES = { n: "noun", v: "verb", adj: "adjective", adv: "adverb", phr: "phrase", "phrasal verb": "phrase", idiom: "phrase", collocation: "phrase" };
const MAX_PROBLEMS_SHOWN = 3;

// Pull the JSON object out of what the learner pasted: plain JSON, JSON in a ``` fence, or JSON with a sentence around it.
export function extractJson(text) {
  const raw = String(text ?? "").trim();
  if (!raw) throw new AiFormatError("Ô dán đang trống. Hãy dán toàn bộ câu trả lời của Claude.");
  const attempts = [raw];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (fenced) attempts.push(fenced[1].trim());
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a !== -1 && b > a) attempts.push(raw.slice(a, b + 1));
  let lastError = null;
  for (const candidate of attempts) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
      lastError = new Error("không phải một đối tượng JSON");
    } catch (e) {
      lastError = e;
    }
  }
  if (a === -1) throw new AiFormatError("Không thấy JSON trong nội dung đã dán. Hãy dán đúng câu trả lời của Claude (bắt đầu bằng dấu {).");
  throw new AiFormatError(`JSON không đọc được (${lastError.message}). Có thể câu trả lời bị cắt dở: hãy bảo Claude gửi lại toàn bộ JSON.`);
}

const text = (v) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");
const strList = (v) => (Array.isArray(v) ? v.map(text).filter(Boolean) : null);

function checkVocabItem(raw) {
  const problems = [];
  const lemma = text(raw.lemma);
  if (!lemma) problems.push("thiếu lemma");
  const posKey = text(raw.pos).toLowerCase();
  const pos = POS_VALUES.includes(posKey) ? posKey : POS_ALIASES[posKey];
  if (!pos) problems.push(`pos "${text(raw.pos)}" không hợp lệ (chỉ nhận ${POS_VALUES.join(", ")})`);
  const meaningVi = text(raw.meaningVi);
  if (!meaningVi) problems.push("thiếu meaningVi");
  if (typeof raw.ipa !== "string") problems.push("thiếu ipa");
  const collocations = strList(raw.collocations ?? []);
  if (collocations === null) problems.push("collocations phải là một danh sách");
  const wordFamily = strList(raw.wordFamily ?? []);
  if (wordFamily === null) problems.push("wordFamily phải là một danh sách");
  if (raw.example !== undefined && typeof raw.example !== "string") problems.push("example phải là chuỗi");
  if (raw.noteVi !== undefined && raw.noteVi !== null && typeof raw.noteVi !== "string") problems.push("noteVi phải là chuỗi");
  if (problems.length) return { problems };
  return {
    item: {
      id: text(raw.id), lemma, pos, ipa: text(raw.ipa), meaningVi, collocations, example: text(raw.example), wordFamily, noteVi: text(raw.noteVi),
    },
  };
}

function checkErrorItem(raw) {
  const problems = [];
  const type = text(raw.type).toLowerCase();
  if (!ERROR_TYPE_SLUGS.includes(type)) problems.push(`type "${text(raw.type)}" không thuộc 10 nhóm lỗi`);
  const signature = text(raw.signature).toLowerCase().replace(/\s/g, "");
  const colon = signature.indexOf(":");
  if (colon < 1 || colon === signature.length - 1) problems.push('signature phải có dạng "nhóm:quy-tắc"');
  else if (ERROR_TYPE_SLUGS.includes(type) && signature.slice(0, colon) !== type) problems.push(`signature "${signature}" phải bắt đầu bằng "${type}:"`);
  const corrected = text(raw.corrected);
  if (!corrected) problems.push("thiếu corrected");
  const explanationVi = text(raw.explanationVi);
  if (!explanationVi) problems.push("thiếu explanationVi");
  if (raw.correctExample !== undefined && typeof raw.correctExample !== "string") problems.push("correctExample phải là chuỗi");
  if (problems.length) return { problems };
  return { item: { id: text(raw.id), type, signature, corrected, explanationVi, correctExample: text(raw.correctExample) } };
}

const CHECKERS = { vocab_enrich: checkVocabItem, error_enrich: checkErrorItem };

// Parse and check the answer to an enrich task. `sentIds` are the ids that were put in the prompt.
// Returns { items, missingIds }. Throws AiFormatError (Vietnamese message) and the caller saves nothing.
export function parseEnrichResult(task, pasted, sentIds) {
  const check = CHECKERS[task];
  if (!check) throw new AiFormatError(`Tác vụ "${task}" chưa hỗ trợ.`);
  const json = extractJson(pasted);
  if (json.schemaVersion !== undefined && json.schemaVersion !== AI_SCHEMA_VERSION) {
    throw new AiFormatError(`schemaVersion ${json.schemaVersion} không đúng (cần ${AI_SCHEMA_VERSION}).`);
  }
  if (json.task !== task) {
    throw new AiFormatError(`JSON này là của tác vụ "${json.task ?? "không rõ"}", không phải "${task}". Có thể bạn đã dán nhầm câu trả lời.`);
  }
  if (!Array.isArray(json.items)) throw new AiFormatError('JSON thiếu danh sách "items".');
  if (json.items.length === 0) throw new AiFormatError('Danh sách "items" đang trống.');

  const sent = new Set(sentIds);
  const seen = new Set();
  const problems = [];
  const items = [];
  json.items.forEach((raw, i) => {
    const label = `Mục ${i + 1}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      problems.push(`${label} không phải một đối tượng.`);
      return;
    }
    const id = text(raw.id);
    if (!id) {
      problems.push(`${label} thiếu id.`);
      return;
    }
    if (!sent.has(id)) {
      problems.push(`${label}: id "${id}" không khớp mục nào trong prompt đã gửi.`);
      return;
    }
    if (seen.has(id)) {
      problems.push(`${label}: id "${id}" bị lặp.`);
      return;
    }
    seen.add(id);
    const res = check(raw);
    if (res.problems) problems.push(`${label} (id ${id}): ${res.problems.join("; ")}.`);
    else items.push(res.item);
  });
  if (problems.length) {
    const shown = problems.slice(0, MAX_PROBLEMS_SHOWN).join(" ");
    const more = problems.length > MAX_PROBLEMS_SHOWN ? ` (và ${problems.length - MAX_PROBLEMS_SHOWN} lỗi nữa)` : "";
    throw new AiFormatError(`${shown}${more} Không có gì được lưu.`);
  }
  return { items, missingIds: sentIds.filter((id) => !seen.has(id)) };
}

// ---- Writing & Speaking analysis (step 8b, spec 5.6 and 7.3) ----

export const ANALYSIS_TASKS = ["writing_task1", "writing_task2", "speaking"];
// The four criteria of each task, in the order they are stored as bands.c1..c4.
export const CRITERIA = {
  writing_task1: ["TA", "CC", "LR", "GRA"],
  writing_task2: ["TR", "CC", "LR", "GRA"],
  speaking: ["FC", "LR", "GRA", "P"],
};
export const CRITERIA_LABELS = {
  TA: "Task Achievement", TR: "Task Response", CC: "Coherence & Cohesion", LR: "Lexical Resource",
  GRA: "Grammatical Range & Accuracy", FC: "Fluency & Coherence", P: "Pronunciation",
};
export const SEVERITIES = ["high", "medium", "low"];

export const isBandValue = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 9 && (v * 2) % 1 === 0;
const wholeNumber = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

function checkError(raw) {
  const problems = [];
  const original = text(raw.original);
  if (!original) problems.push("thiếu original");
  const corrected = text(raw.corrected);
  if (!corrected) problems.push("thiếu corrected");
  const type = text(raw.type).toLowerCase();
  if (!ERROR_TYPE_SLUGS.includes(type)) problems.push(`type "${text(raw.type)}" không thuộc 10 nhóm lỗi`);
  const signature = text(raw.signature).toLowerCase().replace(/\s/g, "");
  const colon = signature.indexOf(":");
  if (colon < 1 || colon === signature.length - 1) problems.push('signature phải có dạng "nhóm:quy-tắc"');
  else if (ERROR_TYPE_SLUGS.includes(type) && signature.slice(0, colon) !== type) problems.push(`signature "${signature}" phải bắt đầu bằng "${type}:"`);
  const explanationVi = text(raw.explanationVi);
  if (!explanationVi) problems.push("thiếu explanationVi");
  if (raw.correctExample !== undefined && raw.correctExample !== null && typeof raw.correctExample !== "string") problems.push("correctExample phải là chuỗi");
  const severity = raw.severity === undefined || raw.severity === null ? "medium" : text(raw.severity).toLowerCase();
  if (!SEVERITIES.includes(severity)) problems.push(`severity "${text(raw.severity)}" không hợp lệ (high, medium hoặc low)`);
  if (problems.length) return { problems };
  // start / end are only a hint: when they are not whole numbers or do not fit, the text is searched for `original`.
  const start = wholeNumber(raw.start);
  const end = wholeNumber(raw.end);
  return {
    item: {
      original, corrected, type, signature, explanationVi, correctExample: text(raw.correctExample), severity,
      start: start !== null && end !== null && end > start ? start : null, end: start !== null && end !== null && end > start ? end : null,
    },
  };
}

function checkSuggestion(raw) {
  const res = checkVocabItem({ ...raw, id: "x", lemma: raw.lemma ?? raw.word });
  if (res.problems) return res;
  const word = text(raw.word) || res.item.lemma;
  return { item: { word, lemma: res.item.lemma, pos: res.item.pos, ipa: res.item.ipa, meaningVi: res.item.meaningVi, collocations: res.item.collocations, example: res.item.example } };
}

const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);

// Parse and check the answer to writing_task1 / writing_task2 / speaking. Returns the cleaned result.
// Throws AiFormatError (Vietnamese) and the caller saves nothing. A different overall from the one the four criteria
// give is NOT an error: the app recomputes it (services/analysis.js).
export function parseAnalysisResult(task, pasted) {
  const criteria = CRITERIA[task];
  if (!criteria) throw new AiFormatError(`Tác vụ "${task}" chưa hỗ trợ.`);
  const json = extractJson(pasted);
  if (json.schemaVersion !== undefined && json.schemaVersion !== AI_SCHEMA_VERSION) {
    throw new AiFormatError(`schemaVersion ${json.schemaVersion} không đúng (cần ${AI_SCHEMA_VERSION}).`);
  }
  if (json.task !== task) {
    throw new AiFormatError(`JSON này là của tác vụ "${json.task ?? "không rõ"}", không phải "${task}". Có thể bạn đã dán nhầm câu trả lời hoặc chọn sai Task. Không có gì được lưu.`);
  }

  const problems = [];
  const bands = {};
  if (!isObject(json.bands)) {
    problems.push('thiếu "bands"');
  } else {
    const allowed = ["overall", ...criteria];
    const extra = Object.keys(json.bands).filter((k) => !allowed.includes(k));
    if (extra.length) problems.push(`bands có tiêu chí "${extra.join(", ")}" không thuộc bộ tiêu chí của tác vụ này (cần ${criteria.join(", ")})`);
    for (const key of allowed) {
      const v = json.bands[key];
      if (v === undefined) problems.push(`bands thiếu ${key}`);
      else if (!isBandValue(v)) problems.push(`bands.${key} = ${JSON.stringify(v)} không hợp lệ (số từ 0 đến 9, bước 0.5)`);
      else bands[key] = v;
    }
  }
  const criteriaFeedbackVi = {};
  if (!isObject(json.criteriaFeedbackVi)) {
    problems.push('thiếu "criteriaFeedbackVi"');
  } else {
    for (const key of criteria) {
      const v = text(json.criteriaFeedbackVi[key]);
      if (!v) problems.push(`criteriaFeedbackVi thiếu nhận xét ${key}`);
      else criteriaFeedbackVi[key] = v;
    }
    const extra = Object.keys(json.criteriaFeedbackVi).filter((k) => !criteria.includes(k) && k !== "overall");
    if (extra.length) problems.push(`criteriaFeedbackVi có tiêu chí "${extra.join(", ")}" không thuộc bộ tiêu chí của tác vụ này`);
  }

  const errors = [];
  if (!Array.isArray(json.errors)) {
    problems.push('"errors" phải là một danh sách (có thể rỗng)');
  } else {
    json.errors.forEach((raw, i) => {
      if (!isObject(raw)) { problems.push(`Lỗi ${i + 1} không phải một đối tượng`); return; }
      const res = checkError(raw);
      if (res.problems) problems.push(`Lỗi ${i + 1}: ${res.problems.join("; ")}`);
      else errors.push(res.item);
    });
  }

  const minimalCorrectedText = typeof json.minimalCorrectedText === "string" ? json.minimalCorrectedText.trim() : "";
  if (!minimalCorrectedText) problems.push("thiếu minimalCorrectedText");
  const band7Text = typeof json.band7Text === "string" ? json.band7Text.trim() : "";
  if (!band7Text) problems.push("thiếu band7Text");

  const vocabularySuggestions = [];
  if (json.vocabularySuggestions !== undefined && !Array.isArray(json.vocabularySuggestions)) {
    problems.push('"vocabularySuggestions" phải là một danh sách');
  } else {
    (json.vocabularySuggestions ?? []).forEach((raw, i) => {
      if (!isObject(raw)) { problems.push(`Từ gợi ý ${i + 1} không phải một đối tượng`); return; }
      const res = checkSuggestion(raw);
      if (res.problems) problems.push(`Từ gợi ý ${i + 1}: ${res.problems.join("; ")}`);
      else vocabularySuggestions.push(res.item);
    });
  }

  let dataAccuracyChecked = null;
  if (task === "writing_task1") {
    if (typeof json.dataAccuracyChecked !== "boolean") problems.push("thiếu dataAccuracyChecked (true hoặc false)");
    else dataAccuracyChecked = json.dataAccuracyChecked;
  }

  if (problems.length) {
    const shown = problems.slice(0, MAX_PROBLEMS_SHOWN).map((p) => `${p}.`).join(" ");
    const more = problems.length > MAX_PROBLEMS_SHOWN ? ` (và ${problems.length - MAX_PROBLEMS_SHOWN} lỗi nữa)` : "";
    throw new AiFormatError(`${shown}${more} Không có gì được lưu.`);
  }
  return { task, bands, criteriaFeedbackVi, errors, minimalCorrectedText, band7Text, vocabularySuggestions, dataAccuracyChecked };
}