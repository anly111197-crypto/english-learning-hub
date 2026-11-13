// The only door to Claude for the views (spec 7.3, 8). A view calls startTask() and gets a session back; it never
// builds prompts or checks JSON itself. Today there is one mode, "manual" (copy / paste). Step 9 adds "api" here:
// that session will resolve its own result, and the views will not need to change.
import { buildPrompt, buildAnalysisPrompt } from "./prompts.js";
import { parseEnrichResult, parseAnalysisResult, ANALYSIS_TASKS } from "./schema.js";

// Step 9 will read the saved "aiMode" setting (manual | api) here. Until then everything is copy/paste.
export const getAiMode = () => "manual";

// task: "vocab_enrich" | "error_enrich". input: { items, signatures? } (see js/services/enrich.js).
// Returns { mode, prompt, accept(pastedText) }. accept() returns { items, missingIds } or throws AiFormatError;
// nothing is saved by this layer.
// Writing & Speaking (step 8b): task is "writing_task1" | "writing_task2" | "speaking"; input = { questionText, text,
// wordCount, taskType, part, signatures }. accept() returns the cleaned analysis result or throws AiFormatError.
export function startTask(task, input) {
  if (ANALYSIS_TASKS.includes(task)) {
    return { mode: getAiMode(), prompt: buildAnalysisPrompt(task, input), accept: (pasted) => parseAnalysisResult(task, pasted) };
  }
  const prompt = buildPrompt(task, input);
  const sentIds = input.items.map((i) => i.id);
  return {
    mode: getAiMode(),
    prompt,
    accept: (pasted) => parseEnrichResult(task, pasted, sentIds),
  };
}
