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
