// Edit panel for one error: correction, group, Vietnamese rule, correct example, status.
import { h, autoGrow } from "../components/dom.js";
import { ERROR_TYPES } from "../services/taxonomy.js";
import { STATUSES, STATUS_LABELS, normalizeType } from "../services/errors.js";

const field = (label, el, id, hint) => h("div", { class: "field" },
  h("label", { class: "field-label", for: id }, label), el, hint ? h("p", { class: "form-hint" }, hint) : null);

// on: { save(fields), merge(), remove() }
export function buildErrorEdit(error, on) {
  const corrected = h("textarea", { id: "ed-right", class: "input textarea", rows: "2", placeholder: "Câu đúng (sửa tối thiểu)" }, error.corrected ?? "");
  const type = h("select", { id: "ed-type", class: "input" },
    h("option", { value: "", selected: normalizeType(error.type) === "" ? true : null }, "Chưa rõ"),
    ERROR_TYPES.map((t) => h("option", { value: t.slug, selected: error.type === t.slug ? true : null }, t.label)));
  const status = h("select", { id: "ed-status", class: "input" },
    STATUSES.map((s) => h("option", { value: s, selected: error.status === s ? true : null }, STATUS_LABELS[s])));
  const rule = h("textarea", { id: "ed-rule", class: "input textarea", rows: "3", placeholder: "Quy tắc bằng tiếng Việt" }, error.explanationVi ?? "");
  const example = h("textarea", { id: "ed-example", class: "input textarea", rows: "2", placeholder: "Một câu đúng làm ví dụ" }, error.correctExample ?? "");
  for (const t of [corrected, rule, example]) autoGrow(t);

  const message = h("p", { class: "form-error", role: "alert", hidden: true });

  async function submit(e) {
    e.preventDefault();
    message.hidden = true;
    try {
      await on.save({ corrected: corrected.value, type: type.value, status: status.value, explanationVi: rule.value, correctExample: example.value });
    } catch (err) {
      message.textContent = err.message || "Không lưu được.";
      message.hidden = false;
    }
  }

  const node = h("div", { class: "detail error-edit" },
    h("p", { class: "section-label" }, "Câu sai"),
    h("p", { class: "edit-wrong" }, error.original),
    h("form", { class: "form", novalidate: true, onSubmit: submit },
      field("Câu đúng", corrected, "ed-right"),
      h("div", { class: "field-row" }, field("Nhóm lỗi", type, "ed-type"), field("Trạng thái", status, "ed-status")),
      field("Giải thích tiếng Việt", rule, "ed-rule"),
      field("Ví dụ đúng", example, "ed-example"),
      message,
      h("div", { class: "detail-actions" },
        h("button", { type: "submit", class: "btn btn-primary" }, "Lưu thay đổi"),
        h("button", { type: "button", class: "btn btn-outline", onClick: on.merge }, "Gộp với lỗi khác…"),
        h("button", { type: "button", class: "btn btn-danger", onClick: on.remove }, "Xoá lỗi"))));

  return { title: "Sửa lỗi", badge: STATUS_LABELS[error.status] ?? "", node };
}
