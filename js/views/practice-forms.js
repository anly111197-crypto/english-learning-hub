// Forms opened from the test panel: "Nhập kết quả" and "Sửa link".
import { openModal } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import { h, autoGrow, todayIso } from "../components/dom.js";
import { rawToBand, isBelowTable, formatBand } from "../services/bands.js";
import { saveAttempt, setLinks, isHttpsUrl } from "../services/practice-store.js";
import { SKILLS, SKILL_NAMES } from "../services/progress.js";

const existingFor = (entry, skill, task) => (skill === "W" ? entry?.[`W${task}`] : entry?.[skill]);

function resultText(skill, rawText) {
  if (rawText.trim() === "") return "Nhập số câu đúng để xem band.";
  const raw = Number(rawText);
  if (!Number.isInteger(raw) || raw < 0 || raw > 40) return "Số câu đúng phải là số nguyên từ 0 đến 40.";
  const label = skill === "L" ? "Listening" : "Academic Reading";
  const below = isBelowTable(raw) ? ", dưới bảng quy đổi, ước lượng" : "";
  return `${raw}/40 câu đúng → Band ${formatBand(rawToBand(skill, raw))} (${label}${below})`;
}

// entry = { L, R, S, W1, W2 } existing attempts of this test (may be undefined).
export function openResultModal({ book, test, skill = "L", task = 2, entry, onSaved }) {
  const state = { skill, task };
  const tabs = h("div", { class: "seg", role: "tablist", "aria-label": "Kỹ năng" });
  const fields = h("div", { class: "form-fields" });
  const error = h("p", { class: "form-error", role: "alert", hidden: true });

  function renderFields() {
    const old = existingFor(entry, state.skill, state.task);
    const isLR = state.skill === "L" || state.skill === "R";

    for (const btn of tabs.children) {
      btn.setAttribute("aria-selected", String(btn.dataset.skill === state.skill));
    }

    const parts = [];
    if (state.skill === "W") {
      parts.push(h("div", { class: "field" },
        h("span", { class: "field-label" }, "Task"),
        h("div", { class: "seg seg-small" }, [1, 2].map((t) =>
          h("button", {
            type: "button", class: "seg-btn", "aria-pressed": String(state.task === t),
            onClick: () => { state.task = t; renderFields(); },
          }, `Task ${t}`)))));
    }

    let rawInput = null;
    let bandInput = null;
    let preview = null;
    if (isLR) {
      rawInput = h("input", {
        id: "f-raw", class: "input", type: "number", inputmode: "numeric", min: "0", max: "40", step: "1",
        value: old?.rawScore ?? "", required: true,
      });
      preview = h("p", { class: "result-box", "aria-live": "polite" }, resultText(state.skill, String(old?.rawScore ?? "")));
      rawInput.addEventListener("input", () => { preview.textContent = resultText(state.skill, rawInput.value); });
      parts.push(h("div", { class: "field" },
        h("label", { class: "field-label", for: "f-raw" }, `Số câu đúng (${SKILL_NAMES[state.skill]})`),
        h("div", { class: "input-suffix" }, rawInput, h("span", { class: "nowrap" }, "/40 câu")),
        preview));
    } else {
      bandInput = h("input", {
        id: "f-band", class: "input", type: "number", inputmode: "decimal", min: "0", max: "9", step: "0.5",
        value: old?.band ?? "", required: true,
      });
      const name = state.skill === "W" ? `Writing Task ${state.task}` : "Speaking";
      parts.push(h("div", { class: "field" },
        h("label", { class: "field-label", for: "f-band" }, `Band ${name} (0–9, bước 0.5)`),
        bandInput));
    }

    const dateInput = h("input", { id: "f-date", class: "input", type: "date", value: old?.date ?? todayIso(), required: true });
    const minInput = h("input", {
      id: "f-min", class: "input", type: "number", inputmode: "numeric", min: "1", max: "600", step: "1",
      value: old?.durationMin ?? "",
    });
    const noteInput = h("textarea", { id: "f-note", class: "input textarea", rows: "2", placeholder: "Ghi chú (không bắt buộc)" }, old?.note ?? "");
    autoGrow(noteInput);
    parts.push(
      h("div", { class: "field-row" },
        h("div", { class: "field" }, h("label", { class: "field-label", for: "f-date" }, "Ngày làm bài"), dateInput),
        h("div", { class: "field" }, h("label", { class: "field-label", for: "f-min" }, "Thời gian (phút)"), minInput)),
      h("div", { class: "field" }, h("label", { class: "field-label", for: "f-note" }, "Ghi chú (tùy chọn)"), noteInput));

    fields.replaceChildren(...parts);
    fields._read = { rawInput, bandInput, dateInput, minInput, noteInput };
    error.hidden = true;
  }

  for (const k of SKILLS) {
    tabs.append(h("button", {
      type: "button", class: "seg-btn", role: "tab", dataset: { skill: k },
      onClick: () => { state.skill = k; renderFields(); },
    }, SKILL_NAMES[k]));
  }

  const fail = (msg) => { error.textContent = msg; error.hidden = false; };

  async function submit(e) {
    e.preventDefault();
    const { rawInput, bandInput, dateInput, minInput, noteInput } = fields._read;
    const isLR = state.skill === "L" || state.skill === "R";
    let rawScore = null;
    let band;
    if (isLR) {
      const raw = Number(rawInput.value);
      if (rawInput.value.trim() === "" || !Number.isInteger(raw) || raw < 0 || raw > 40) return fail("Số câu đúng phải là số nguyên từ 0 đến 40.");
      rawScore = raw;
      band = rawToBand(state.skill, raw);
    } else {
      band = Number(bandInput.value);
      if (bandInput.value.trim() === "" || !Number.isFinite(band) || band < 0 || band > 9 || (band * 2) % 1 !== 0) {
        return fail("Band phải từ 0 đến 9, bước 0.5.");
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput.value)) return fail("Chọn ngày làm bài.");
    let durationMin = null;
    if (minInput.value.trim() !== "") {
      durationMin = Number(minInput.value);
      if (!Number.isInteger(durationMin) || durationMin < 1 || durationMin > 600) return fail("Thời gian là số phút nguyên, từ 1 đến 600.");
    }
    try {
      await saveAttempt({
        book, test, skill: state.skill, task: state.skill === "W" ? state.task : null,
        rawScore, band, date: dateInput.value, durationMin, note: noteInput.value.trim(),
      });
    } catch (err) {
      return fail(err.message || "Không lưu được.");
    }
    modal.close();
    showToast(`Đã lưu ${SKILL_NAMES[state.skill]} · Cam ${book} Test ${test}: Band ${formatBand(band)}`);
    await onSaved?.();
  }

  const form = h("form", { id: "result-form", class: "form", novalidate: true, onSubmit: submit }, tabs, fields, error);
  const footer = h("div", { class: "modal-actions" },
    h("button", { type: "button", class: "btn btn-text", onClick: () => modal.close() }, "Hủy"),
    h("button", { type: "submit", form: "result-form", class: "btn btn-primary" }, "Lưu kết quả"));
  const modal = openModal({ title: `Nhập kết quả · Cam ${book} – Test ${test}`, content: form, footer });
  renderFields();
  return modal;
}

const LINK_FIELDS = [
  { id: "pdf", label: "Link đề PDF" },
  { id: "a1", label: "Link audio Part 1" },
  { id: "a2", label: "Link audio Part 2" },
  { id: "a3", label: "Link audio Part 3" },
  { id: "a4", label: "Link audio Part 4" },
];

// Links are the learner's own files (usually private Google Drive links). Only https:// is accepted.
export function openLinksModal({ book, test, testRec, onSaved }) {
  const current = [testRec?.pdfUrl ?? "", ...(testRec?.audioUrls ?? ["", "", "", ""])];
  const inputs = LINK_FIELDS.map((f, i) => h("input", {
    id: `f-${f.id}`, class: "input", type: "url", inputmode: "url", placeholder: "https://…", value: current[i] ?? "",
    autocomplete: "off",
  }));
  const error = h("p", { class: "form-error", role: "alert", hidden: true });

  async function submit(e) {
    e.preventDefault();
    const values = inputs.map((i) => i.value.trim());
    for (let i = 0; i < values.length; i++) {
      if (values[i] && !isHttpsUrl(values[i])) {
        error.textContent = `${LINK_FIELDS[i].label}: link phải bắt đầu bằng https://`;
        error.hidden = false;
        inputs[i].focus();
        return;
      }
    }
    try {
      await setLinks(book, test, { pdfUrl: values[0], audioUrls: values.slice(1) });
    } catch (err) {
      error.textContent = err.message || "Không lưu được.";
      error.hidden = false;
      return;
    }
    modal.close();
    showToast(`Đã lưu link · Cam ${book} Test ${test}`);
    await onSaved?.();
  }

  const form = h("form", { id: "links-form", class: "form", novalidate: true, onSubmit: submit },
    h("p", { class: "form-hint" }, "Dán link file của bạn (ví dụ link Google Drive riêng tư). Ứng dụng không lưu file đề hay audio."),
    LINK_FIELDS.map((f, i) => h("div", { class: "field" }, h("label", { class: "field-label", for: `f-${f.id}` }, f.label), inputs[i])),
    error);
  const footer = h("div", { class: "modal-actions" },
    h("button", { type: "button", class: "btn btn-text", onClick: () => modal.close() }, "Hủy"),
    h("button", { type: "submit", form: "links-form", class: "btn btn-primary" }, "Lưu link"));
  const modal = openModal({ title: `Sửa link · Cam ${book} – Test ${test}`, content: form, footer });
  return modal;
}
