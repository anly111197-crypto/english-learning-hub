// "Tạo bài tập" dialog of the Grammar Notebook (step 8c, copy / paste mode): the mistakes that will be practised, then
// copy the prompt -> open Claude -> paste the JSON -> the exercise is stored and opens. Nothing is stored on a bad answer.
import { h } from "./dom.js";
import { openModal } from "./modal.js";
import { showToast } from "./toast.js";
import { createCopyPaste } from "./copy-paste.js";
import { startTask } from "../ai/index.js";
import { AiFormatError, ITEMS_PER_ERROR } from "../ai/schema.js";
import { exercisePromptErrors, validateSelection, pickExerciseErrors, errorLabel } from "../services/exercise.js";
import { createExercise } from "../services/exercise-ops.js";

let opening = false;

// selected: the mistakes the learner ticked (1-5). With none ticked, the 5 mistakes of rule 6.4 that can be practised are
// proposed. allErrors: every live mistake.
export function openExerciseStart({ selected, allErrors }) {
  if (opening) return;
  const auto = selected.length === 0;
  const chosen = auto ? pickExerciseErrors(allErrors) : selected;
  if (auto && chosen.length === 0) {
    showToast("Chưa có lỗi nào đủ điều kiện: lỗi cần được hoàn thiện với Claude (có signature và câu sửa) trước.", "error");
    return;
  }
  const problem = auto ? "" : validateSelection(chosen);
  if (problem) {
    showToast(problem, "error");
    return;
  }
  let session;
  try {
    session = startTask("exercise_generate", { errors: exercisePromptErrors(chosen) });
  } catch (e) {
    showToast(e.message || "Không tạo được prompt.", "error");
    return;
  }
  opening = true;

  const body = h("div", { class: "enrich ex-start", dataset: { kind: "exercise" } });
  const footer = h("div", { class: "modal-actions" });
  const modal = openModal({ title: `Tạo bài tập · ${chosen.length} lỗi`, content: body, footer, onClose: () => { opening = false; } });
  modal.el.classList.add("modal-wide");

  const cp = createCopyPaste({
    prompt: session.prompt, prefix: "ex",
    before: [
      h("p", { class: "ex-start-intro", dataset: { role: "ex-intro" } },
        auto ? `Bạn chưa chọn lỗi nào, nên app đề xuất ${chosen.length} lỗi ưu tiên (lỗi chưa khắc phục, làm sai gần đây hoặc lặp nhiều nhất). ` : "",
        `Claude sẽ soạn ${ITEMS_PER_ERROR} câu cho mỗi lỗi, tổng ${chosen.length * ITEMS_PER_ERROR} câu.`),
      h("ul", { class: "ex-start-list", dataset: { role: "ex-errors" } }, chosen.map((e) => h("li", { dataset: { id: e.id } }, errorLabel(e)))),
    ],
  });
  body.replaceChildren(cp.node);

  const read = h("button", {
    type: "button", class: "btn btn-primary", dataset: { role: "ex-read" },
    onClick: async () => {
      let parsed;
      try {
        parsed = session.accept(cp.getText());
      } catch (e) {
        cp.showError(e instanceof AiFormatError ? e.message : "Không đọc được câu trả lời.");
        return;
      }
      read.disabled = true;
      try {
        const ex = await createExercise(parsed.items);
        modal.close();
        document.dispatchEvent(new CustomEvent("elh:data-changed"));
        if (parsed.notes.length) showToast(parsed.notes.join(" "), "ok");
        location.hash = `#/errors/exercise/${ex.id}`;
      } catch (e) {
        read.disabled = false;
        cp.showError(e.message || "Không lưu được bài tập.");
      }
    },
  }, "Đọc JSON");
  footer.replaceChildren(h("button", { type: "button", class: "btn btn-text", onClick: () => modal.close() }, "Hủy"), read);
}
