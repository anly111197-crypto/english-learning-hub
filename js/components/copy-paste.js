// Copy / paste block shared by "Hoàn thiện với Claude" (step 8a) and Writing & Speaking AI (step 8b):
//   Sao chép prompt -> Mở Claude -> Dán -> (the caller's own "Đọc JSON" button).
// The clipboard call is the first thing in the click handler (Safari iOS only allows it inside the gesture); when it is
// refused, a text box with the prompt appears already selected. The paste button reads the clipboard when allowed.
// prefix names the data-role attributes ("enrich-copy", "ai-copy", ...) that the e2e scripts use.
import { h } from "./dom.js";

export const CLAUDE_URL = "https://claude.ai/new";

export function createCopyPaste({ prompt, prefix, prefill = "", steps = null, before = [], inputRows = 7 }) {
  const role = (name) => ({ role: `${prefix}-${name}` });
  const note = h("p", { class: "muted enrich-copy-note", role: "status" });
  const fallback = h("textarea", {
    class: "input textarea enrich-fallback", readonly: true, rows: "6", hidden: true,
    "aria-label": "Prompt để tự sao chép", dataset: role("fallback"),
  });
  fallback.value = prompt;
  const showFallback = (message) => {
    fallback.hidden = false;
    fallback.focus();
    fallback.select();
    fallback.setSelectionRange(0, fallback.value.length); // iOS needs the explicit range
    note.textContent = message;
  };
  const onCopy = () => {
    if (!navigator.clipboard?.writeText) {
      showFallback("Trình duyệt không cho sao chép tự động. Prompt đã được chọn sẵn: hãy sao chép nó (Ctrl+C, hoặc bấm giữ rồi chọn Sao chép).");
      return;
    }
    navigator.clipboard.writeText(prompt).then(
      () => { fallback.hidden = true; note.textContent = "Đã sao chép prompt. Mở Claude, dán vào, rồi dán câu trả lời của Claude vào ô bên dưới."; },
      () => showFallback("Không sao chép được tự động. Prompt đã được chọn sẵn: hãy sao chép nó (Ctrl+C, hoặc bấm giữ rồi chọn Sao chép)."));
  };

  const error = h("p", { class: "form-error enrich-error", role: "alert", hidden: true, dataset: role("error") });
  const input = h("textarea", {
    class: "input textarea enrich-input", rows: String(inputRows), placeholder: "Dán câu trả lời JSON của Claude vào đây",
    "aria-label": "Câu trả lời của Claude", dataset: role("input"),
    onInput: () => { error.hidden = true; },
  });
  input.value = prefill;
  const pasteNote = h("p", { class: "form-hint enrich-paste-note", role: "status" });
  const onPaste = () => {
    if (!navigator.clipboard?.readText) {
      pasteNote.textContent = "Trình duyệt không cho đọc bộ nhớ tạm. Bấm giữ vào ô bên dưới rồi chọn Dán.";
      input.focus();
      return;
    }
    navigator.clipboard.readText().then(
      (text) => {
        if (!text.trim()) { pasteNote.textContent = "Bộ nhớ tạm đang trống."; return; }
        input.value = text;
        error.hidden = true;
        pasteNote.textContent = "Đã dán. Bấm Đọc JSON để xem kết quả.";
      },
      () => { pasteNote.textContent = "Không đọc được bộ nhớ tạm. Bấm giữ vào ô bên dưới rồi chọn Dán."; input.focus(); });
  };

  const stepList = steps ?? [
    h("li", {}, "Bấm ", h("strong", {}, "Sao chép prompt"), "."),
    h("li", {}, "Mở Claude, dán prompt và chờ Claude trả về JSON."),
    h("li", {}, "Sao chép câu trả lời, dán vào ô bên dưới rồi bấm ", h("strong", {}, "Đọc JSON"), "."),
  ];
  const node = h("div", { class: "copy-paste" },
    h("ol", { class: "enrich-steps" }, ...stepList),
    ...before.filter(Boolean),
    h("div", { class: "enrich-actions" },
      h("button", { type: "button", class: "btn btn-primary", dataset: role("copy"), onClick: onCopy }, "Sao chép prompt"),
      h("a", { class: "btn btn-outline", href: CLAUDE_URL, target: "_blank", rel: "noopener noreferrer", dataset: role("open-claude") }, "Mở Claude")),
    note, fallback,
    h("div", { class: "enrich-paste-head" },
      h("span", { class: "field-label" }, "Câu trả lời của Claude"),
      h("button", { type: "button", class: "btn btn-outline btn-sm", dataset: role("paste"), onClick: onPaste }, "Dán")),
    pasteNote, input, error);

  return {
    node,
    input,
    getText: () => input.value,
    showError(message) { error.textContent = message; error.hidden = false; },
    clearError() { error.hidden = true; },
  };
}
