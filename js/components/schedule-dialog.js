// "Cài đặt lịch": exam date, study days, minutes per session, session kind and book order (spec 5.1).
import { h } from "./dom.js";
import { openModal } from "./modal.js";
import { showToast } from "./toast.js";
import { saveSchedule } from "../services/schedule-ops.js";
import { normalizeSettings, WEEKDAY_LABELS, MIN_SESSION_MINUTES, WARMUP_MINUTES } from "../services/schedule.js";

// current: the stored record or null; today: "YYYY-MM-DD"; onSaved(): runs after a successful save.
export function openScheduleDialog({ current, today, onSaved }) {
  const s = normalizeSettings(current);

  const examInput = h("input", { type: "date", id: "sch-exam", class: "input", dataset: { role: "sch-exam" } });
  examInput.value = s.examDate;
  const minutesInput = h("input", { type: "number", id: "sch-minutes", class: "input", inputmode: "numeric", step: "5", dataset: { role: "sch-minutes" } });
  minutesInput.value = String(s.minutes);

  const dayBoxes = Object.entries(WEEKDAY_LABELS).map(([n, label]) => {
    const box = h("input", { type: "checkbox", dataset: { day: n } });
    box.checked = s.days.includes(Number(n));
    return h("label", { class: "sch-day" }, box, h("span", {}, label));
  });

  const radio = (name, value, label, checked) => {
    const r = h("input", { type: "radio", name, dataset: { value } });
    r.checked = checked;
    return h("label", { class: "sch-radio" }, r, h("span", {}, label));
  };
  const modeRadios = [radio("sch-mode", "skill", "Mỗi buổi 1 kỹ năng", s.mode === "skill"), radio("sch-mode", "test", "Cả test 4 kỹ năng", s.mode === "test")];
  const orderRadios = [radio("sch-order", "new", "Cam mới trước (19 → 10)", s.order === "new"), radio("sch-order", "old", "Cam cũ trước (10 → 19)", s.order === "old")];

  const err = (field) => h("p", { class: "form-error", role: "alert", hidden: true, dataset: { error: field } });
  const errors = { examDate: err("examDate"), days: err("days"), minutes: err("minutes") };
  const formError = h("p", { class: "form-error", role: "alert", hidden: true, dataset: { error: "form" } });

  const picked = (radios) => radios.map((l) => l.querySelector("input")).find((r) => r.checked)?.dataset.value;
  const showErrors = (list) => {
    for (const e of Object.values(errors)) { e.hidden = true; e.textContent = ""; }
    formError.hidden = true;
    for (const { field, message } of list) {
      const el = errors[field];
      if (el) { el.textContent = message; el.hidden = false; }
    }
  };

  let busy = false;
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    try {
      const result = await saveSchedule({
        examDate: examInput.value,
        days: dayBoxes.map((l) => l.querySelector("input")).filter((b) => b.checked).map((b) => Number(b.dataset.day)),
        minutes: minutesInput.value,
        mode: picked(modeRadios),
        order: picked(orderRadios),
      }, today);
      if (!result.ok) { showErrors(result.errors); return; }
      modal.close();
      showToast("Đã lưu lịch học.");
      document.dispatchEvent(new CustomEvent("elh:data-changed"));
      await onSaved?.();
    } catch (err) {
      formError.textContent = err.message || "Không lưu được.";
      formError.hidden = false;
    } finally {
      busy = false;
    }
  }

  const field = (id, label, control, hint, error) => h("div", { class: "field" },
    h("label", { class: "field-label", for: id }, label), control, hint ? h("p", { class: "form-hint" }, hint) : null, error);

  const form = h("form", { id: "schedule-form", class: "form sch-form", novalidate: true, onSubmit: submit },
    field("sch-exam", "Ngày thi dự kiến", examInput, "Để trống nếu chưa có: lịch xếp đều, không có hạn chót.", errors.examDate),
    h("div", { class: "field" },
      h("p", { class: "field-label" }, "Ngày học trong tuần"),
      h("div", { class: "sch-days", role: "group", "aria-label": "Ngày học trong tuần" }, dayBoxes), errors.days),
    field("sch-minutes", "Số phút mỗi buổi", minutesInput, `Tối thiểu ${MIN_SESSION_MINUTES} phút, đã gồm ${WARMUP_MINUTES} phút khởi động.`, errors.minutes),
    h("div", { class: "field" }, h("p", { class: "field-label" }, "Kiểu buổi"), h("div", { class: "sch-radios", role: "radiogroup", "aria-label": "Kiểu buổi" }, modeRadios)),
    h("div", { class: "field" }, h("p", { class: "field-label" }, "Thứ tự"), h("div", { class: "sch-radios", role: "radiogroup", "aria-label": "Thứ tự" }, orderRadios)),
    h("p", { class: "form-hint" }, "Bài đã có điểm được bỏ qua. Lịch tính lại mỗi lần mở Dashboard: bỏ lỡ một buổi thì phần còn lại tự dời sang buổi học kế tiếp."),
    formError);

  const footer = h("div", { class: "modal-actions" },
    h("button", { type: "button", class: "btn btn-text", onClick: () => modal.close() }, "Hủy"),
    h("button", { type: "submit", form: "schedule-form", class: "btn btn-primary", dataset: { role: "sch-save" } }, "Lưu lịch"));
  const modal = openModal({ title: "Cài đặt lịch", content: form, footer });
  return modal;
}
