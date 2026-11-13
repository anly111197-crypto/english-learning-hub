// "Hoàn thiện với Claude" dialog (spec 6.6), copy / paste mode:
//   1. copy the prompt and open Claude   2. paste the JSON answer   3. review each item (editable, tick) and save.
// The view does not know how the answer arrives: it only talks to js/ai/index.js (step 9 adds the API mode there).
import { h } from "./dom.js";
import { openModal } from "./modal.js";
import { createCopyPaste } from "./copy-paste.js";
import { showToast } from "./toast.js";
import { startTask } from "../ai/index.js";
import { AiFormatError, POS_VALUES } from "../ai/schema.js";
import { ERROR_TYPES } from "../services/taxonomy.js";
import { loadEnrichBatch, rowsFor, saveRows } from "../services/enrich-ops.js";
import { findVocabConflict, findErrorConflict, validateVocabValues, validateErrorValues } from "../services/enrich.js";
import { splitList } from "../services/vocab-ops.js";

let opening = false;

const field = (label, control, hint) => h("div", { class: "field" },
  h("span", { class: "field-label" }, label), control, hint ?? null);
const joinList = (arr) => (arr ?? []).join(", ");
// replaceChildren turns a null into the text "null": drop empty slots first.
const fill = (el, ...nodes) => el.replaceChildren(...nodes.filter(Boolean));

// kind: "vocab" | "error". selectedIds: only those items (max 20); without it, the oldest items that still wait.
export async function openEnrich(kind, { selectedIds = null } = {}) {
  if (opening) return;
  opening = true;
  try {
    const data = await loadEnrichBatch(kind, selectedIds);
    if (data.batch.length === 0) {
      showToast("Không có mục nào chờ hoàn thiện.");
      opening = false;
      return;
    }
    const session = startTask(kind === "vocab" ? "vocab_enrich" : "error_enrich", data.input);
    buildDialog(kind, data, session);
  } catch (err) {
    opening = false;
    showToast(err.message || "Không mở được Hoàn thiện với Claude.", "error");
  }
}

function buildDialog(kind, data, session) {
  const noun = kind === "vocab" ? "từ" : "lỗi";
  const body = h("div", { class: "enrich", dataset: { kind } });
  const footer = h("div", { class: "modal-actions" });
  const modal = openModal({
    title: `Hoàn thiện với Claude · ${data.batch.length} ${noun}`,
    content: body, footer, onClose: () => { opening = false; },
  });
  modal.el.classList.add("modal-wide");

  // ---- Steps 1 and 2: copy the prompt, paste the answer (shared block, see components/copy-paste.js) ----
  function showPaste(prefill = "") {
    const rest = data.pending - data.batch.length;
    const cp = createCopyPaste({
      prompt: session.prompt, prefix: "enrich", prefill,
      before: [rest > 0 ? h("p", { class: "muted" }, `Lần này gửi ${data.batch.length} ${noun}; còn ${rest} ${noun} nữa sẽ làm ở lần sau.`) : null],
    });
    fill(body, cp.node);
    footer.replaceChildren(
      h("button", { type: "button", class: "btn btn-text", onClick: () => modal.close() }, "Hủy"),
      h("button", {
        type: "button", class: "btn btn-primary", dataset: { role: "enrich-read" },
        onClick: () => {
          try {
            showReview(session.accept(cp.getText()), cp.getText());
          } catch (e) {
            cp.showError(e instanceof AiFormatError ? e.message : "Không đọc được câu trả lời.");
          }
        },
      }, "Đọc JSON"));
  }
  // ---- Step 3: review ----
  function showReview(result, pasted) {
    const rows = rowsFor(kind, data.batch, result.items);
    const states = rows.map((row) => ({ row, checked: true, values: structuredClone(row.values), node: null, err: null, plan: null }));
    const saveBtn = h("button", { type: "button", class: "btn btn-primary", dataset: { role: "enrich-save" } }, "");
    const counter = () => {
      const n = states.filter((s) => s.checked).length;
      saveBtn.textContent = `Lưu đã chọn (${n})`;
      saveBtn.disabled = n === 0;
    };

    const sigList = h("datalist", { id: "enrich-sigs" }, ...(data.input.signatures ?? []).map((s) => h("option", { value: s })));
    const cards = states.map((st) => buildRow(st, counter));
    const missing = result.missingIds.length
      ? h("p", { class: "muted enrich-missing" }, `Claude chưa trả ${result.missingIds.length} ${noun} trong lô này: các mục đó vẫn chờ hoàn thiện.`)
      : null;
    fill(body,
      h("p", { class: "enrich-intro" }, `Xem lại từng mục, sửa nếu cần, bỏ tick mục không muốn lưu. Chưa có gì được lưu.`),
      missing, sigList, h("div", { class: "enrich-rows" }, ...cards));
    counter();

    let saving = false;
    saveBtn.addEventListener("click", async () => {
      if (saving) return;
      const chosen = states.filter((s) => s.checked);
      const check = kind === "vocab" ? validateVocabValues : validateErrorValues;
      let firstBad = null;
      for (const st of chosen) {
        const msg = check(st.values);
        st.err.textContent = msg;
        st.err.hidden = !msg;
        if (msg && !firstBad) firstBad = st;
      }
      if (firstBad) {
        firstBad.node.scrollIntoView({ block: "center" });
        showToast("Có mục chưa hợp lệ: hãy sửa hoặc bỏ tick.", "error");
        return;
      }
      saving = true;
      saveBtn.disabled = true;
      let res;
      try {
        res = await saveRows(kind, chosen.map((s) => ({ id: s.row.id, values: s.values })));
      } catch (e) {
        saving = false;
        counter();
        showToast(e.message || "Không lưu được.", "error");
        return;
      }
      modal.close();
      document.dispatchEvent(new CustomEvent("elh:data-changed"));
      const parts = [`Đã lưu ${res.enriched + res.merged} ${noun}`];
      if (res.merged) parts.push(`${res.merged} được gộp vào mục có sẵn`);
      if (res.gone) parts.push(`${res.gone} mục không còn trong kho`);
      if (res.failed.length) parts.push(`${res.failed.length} mục lỗi: ${res.failed[0].message}`);
      showToast(parts.join(" · "), res.failed.length ? "error" : "ok");
    });

    footer.replaceChildren(
      h("button", { type: "button", class: "btn btn-text", dataset: { role: "enrich-back" }, onClick: () => showPaste(pasted) }, "Quay lại"),
      h("button", { type: "button", class: "btn btn-text", onClick: () => modal.close() }, "Hủy"),
      saveBtn);
    body.scrollTop = 0;
  }

  // One editable card per item.
  function buildRow(st, counter) {
    const { row, values } = st;
    const isVocab = kind === "vocab";
    const plan = h("p", { class: "enrich-plan", dataset: { role: "enrich-plan" } });
    st.err = h("p", { class: "form-error enrich-row-error", role: "alert", hidden: true });

    const text = (key, label, opts = {}) => {
      const el = h(opts.area ? "textarea" : "input", {
        class: `input${opts.area ? " textarea enrich-textarea" : ""}`, ...(opts.area ? { rows: "2" } : { type: "text" }),
        dataset: { f: key }, "aria-label": label, autocomplete: "off", autocapitalize: "off", spellcheck: "false",
        ...(opts.list ? { list: opts.list } : {}),
      });
      el.value = opts.list ? values[key] : (opts.asList ? joinList(values[key]) : values[key]);
      el.addEventListener("input", () => {
        values[key] = opts.asList ? splitList(el.value) : el.value;
        refreshPlan();
      });
      return el;
    };
    const select = (key, label, options) => {
      const el = h("select", { class: "input", dataset: { f: key }, "aria-label": label },
        ...options.map(([v, l]) => h("option", { value: v, selected: v === values[key] ? true : null }, l)));
      el.addEventListener("change", () => { values[key] = el.value; refreshPlan(); });
      return el;
    };
    const have = (text) => (text ? h("p", { class: "form-hint enrich-have" }, `Đang có: ${text}`) : null);

    const check = h("input", { type: "checkbox", checked: true, dataset: { f: "check" }, "aria-label": `Lưu mục ${row.label}` });
    check.addEventListener("change", () => { st.checked = check.checked; st.node.dataset.checked = String(check.checked); counter(); });

    let fields;
    if (isVocab) {
      const h0 = row.have;
      fields = [
        row.noteVi ? h("p", { class: "enrich-note", role: "note", dataset: { role: "enrich-note" } },
          h("strong", {}, "Lưu ý: "), row.noteVi,
          h("span", { class: "enrich-note-fix" }, ` Bạn gõ "${row.label}" → từ đề xuất "${values.lemma}" (sửa được ở ô Lemma).`)) : null,
        h("div", { class: "enrich-grid" },
          field("Lemma", text("lemma", "Lemma")),
          field("Loại từ", select("pos", "Loại từ", POS_VALUES.map((p) => [p, p]))),
          field("IPA", text("ipa", "IPA"), have(h0.ipa && h0.ipa !== values.ipa ? h0.ipa : "")),
          field("Nghĩa", text("meaningVi", "Nghĩa tiếng Việt"), have(h0.meaningVi && h0.meaningVi !== values.meaningVi ? h0.meaningVi : ""))),
        field("Collocations (cách nhau bởi dấu phẩy)", text("collocations", "Collocations", { asList: true }),
          have(h0.collocations.length ? `${joinList(h0.collocations)} (được giữ lại và thêm vào)` : "")),
        field("Ví dụ của Claude (không dùng làm câu ngữ cảnh)", text("example", "Ví dụ của Claude")),
        field("Họ từ (cách nhau bởi dấu phẩy)", text("wordFamily", "Họ từ", { asList: true })),
      ];
    } else {
      fields = [
        h("div", { class: "enrich-grid" },
          field("Nhóm lỗi", select("type", "Nhóm lỗi", ERROR_TYPES.map((t) => [t.slug, t.label]))),
          field("Signature", text("signature", "Signature", { list: "enrich-sigs" }))),
        field("Câu sửa (sửa tối thiểu)", text("corrected", "Câu sửa", { area: true }),
          have(row.have.corrected && row.have.corrected !== values.corrected ? row.have.corrected : "")),
        field("Giải thích", text("explanationVi", "Giải thích", { area: true })),
        field("Câu ví dụ đúng", text("correctExample", "Câu ví dụ đúng", { area: true })),
      ];
    }

    // Will this card become a new one or fold into an existing one? Recomputed while the learner edits.
    function refreshPlan() {
      if (isVocab) {
        const other = findVocabConflict(data.all, row.id, values.lemma, values.pos);
        plan.dataset.plan = other ? "merge" : "update";
        plan.textContent = other
          ? `Đã có thẻ "${other.word}" cùng lemma và loại từ: thẻ này sẽ gộp vào đó (giữ nguyên hộp ôn của thẻ cũ).`
          : "Thẻ này được cập nhật.";
      } else {
        const other = findErrorConflict(data.all, row.id, values.signature);
        plan.dataset.plan = other ? "merge" : "update";
        plan.textContent = other
          ? `Signature này đã có ở lỗi "${other.original}": gộp vào đó và cộng số lần gặp.`
          : "Signature mới, không trùng lỗi nào.";
      }
    }
    refreshPlan();

    st.node = h("article", { class: "enrich-row", dataset: { id: row.id, checked: "true" } },
      h("label", { class: "enrich-row-head" }, check, h("span", { class: "enrich-row-title" }, row.label)),
      ...fields.filter(Boolean), plan, st.err);
    return st.node;
  }

  showPaste();
}
