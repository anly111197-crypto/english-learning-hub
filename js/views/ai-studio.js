// Writing & Speaking AI (spec 5.6, step 8b), copy / paste mode: the learner types the question and their text, copies the
// prompt to Claude, pastes the JSON back, reads the result in three tabs, and saves the ticked mistakes and words.
// The view never builds prompts or checks JSON itself: that is js/ai/index.js.
import { h } from "../components/dom.js";
import { showToast } from "../components/toast.js";
import { confirmModal } from "../components/modal.js";
import { createCopyPaste } from "../components/copy-paste.js";
import { startTask } from "../ai/index.js";
import { AiFormatError, CRITERIA, CRITERIA_LABELS } from "../ai/schema.js";
import { BOOKS } from "../services/progress.js";
import { WRITING_TASK_TYPES, errorTypeLabel } from "../services/taxonomy.js";
import { formatBand } from "../services/bands.js";
import { countWords } from "../services/practice-run.js";
import { diffWords } from "../services/diff.js";
import { knownSignatures } from "../services/enrich.js";
import { overallInfo, locateErrors, buildTray, pickerSubmissions, submissionLabel, taskFor } from "../services/analysis.js";
import { loadStudioData, saveStudioDraft, planBand, saveAnalysis } from "../services/analysis-ops.js";

const DRAFT_DELAY_MS = 1200;
const COMPARE_MAX_CELLS = 1500000;
const SEVERITY_LABEL = { high: "Nặng", medium: "Vừa", low: "Nhẹ" };

let s = null; // the open screen

const optionEl = (value, label, selected) => h("option", { value: String(value), selected: selected ? true : null }, label);
const field = (label, control, id) => h("div", { class: "field" }, h("label", { class: "field-label", for: id }, label), control);

function currentTask() {
  return taskFor(s.mode, s.source.task);
}

// ---- Saving what is typed ----
function readForm(x) {
  return {
    kind: x.mode,
    source: x.mode === "writing"
      ? { book: x.source.book || null, test: x.source.book ? x.source.test : null, task: x.source.task }
      : { book: x.source.book || null, test: x.source.book ? x.source.test : null, part: x.source.part },
    taskType: x.mode === "writing" ? x.taskType : "",
    prompt: x.prompt,
    text: x.text,
  };
}

function scheduleSave() {
  clearTimeout(s.saveTimer);
  s.saveTimer = setTimeout(() => flushSave().catch(() => {}), DRAFT_DELAY_MS);
}

// One write at a time, in order: the first save creates the record, the next ones update the same record.
function flushSave() {
  clearTimeout(s.saveTimer);
  const x = s;
  x.chain = x.chain.then(async () => {
    if (!x.text.trim() && !x.id) return null;
    const rec = await saveStudioDraft({ id: x.id, ...readForm(x) });
    x.id = rec.id;
    x.sub = rec;
    return rec;
  });
  return x.chain;
}

// ---- Result ----
function criterionCard(key, result) {
  return h("li", { class: "ai-criterion", dataset: { c: key } },
    h("p", { class: "ai-criterion-head" },
      h("span", { class: "ai-criterion-name" }, `${key} · ${CRITERIA_LABELS[key]}`),
      h("strong", { class: "ai-criterion-band nowrap" }, formatBand(result.bands[key]))),
    h("p", { class: "ai-criterion-text" }, result.criteriaFeedbackVi[key]),
    key === "P" ? h("p", { class: "ai-p-note", dataset: { role: "ai-p-note" } }, "P chỉ là ước lượng từ văn bản, không phải điểm phát âm thật (app không nghe được giọng bạn).") : null);
}

function overallBlock(result) {
  const info = overallInfo(result);
  return h("div", { class: "ai-overall", dataset: { role: "ai-overall" } },
    h("p", { class: "ai-overall-label" }, "Band tổng"),
    h("p", { class: "ai-overall-value nowrap" }, formatBand(info.computed)),
    info.differs
      ? h("p", { class: "ai-overall-diff", dataset: { role: "ai-overall-diff" } }, `Claude: ${formatBand(info.claude)} · Tính theo 4 tiêu chí: ${formatBand(info.computed)}`)
      : null,
    info.differs ? h("p", { class: "form-hint" }, "App dùng số tính theo 4 tiêu chí để ghi vào ma trận.") : null,
    result.task === "writing_task1" && result.dataAccuracyChecked === false
      ? h("p", { class: "ai-badge", dataset: { role: "ai-badge-data" } }, "Chưa kiểm tra số liệu (không có ảnh biểu đồ)")
      : null);
}

function highlightPanel(result) {
  const { segments, missing } = locateErrors(s.text, result.errors);
  const pop = h("div", { class: "ai-pop", hidden: true, dataset: { role: "ai-pop" }, role: "status" });
  const text = h("p", { class: "ai-hl-text", dataset: { role: "ai-hl-text" } },
    ...segments.map((seg) => {
      if (seg.errorIndex === null) return seg.text;
      const err = result.errors[seg.errorIndex];
      const mark = h("mark", {
        class: "ai-hl", tabindex: "0", dataset: { i: String(seg.errorIndex), severity: err.severity }, title: err.explanationVi,
        "aria-label": `Lỗi: ${seg.text}. Sửa thành: ${err.corrected}`,
      }, seg.text);
      const open = () => showPop(pop, result, seg.errorIndex);
      mark.addEventListener("click", open);
      mark.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
      return mark;
    }));
  return h("div", { class: "ai-panel", dataset: { panel: "hl" } },
    h("p", { class: "form-hint" }, "Bấm vào chỗ được tô để xem lỗi. Mọi chỗ tìm thấy đều được tô, kể cả khi lỗi lặp lại."),
    text, pop,
    missing.length ? h("p", { class: "form-hint", dataset: { role: "ai-missing" } }, `${missing.length} lỗi không tìm thấy vị trí trong bài (bài có thể đã được sửa sau khi phân tích). Các lỗi này vẫn có trong khay bên dưới.`) : null);
}

function showPop(pop, result, index) {
  const err = result.errors[index];
  pop.replaceChildren(
    h("p", { class: "ai-pop-line" }, h("span", { class: "ai-pop-wrong" }, err.original), " → ", h("strong", {}, err.corrected)),
    h("p", { class: "ai-pop-meta" }, `${errorTypeLabel(err.type)} · ${err.signature} · ${SEVERITY_LABEL[err.severity]}`),
    h("p", {}, err.explanationVi),
    h("button", {
      type: "button", class: "btn btn-outline btn-sm", dataset: { role: "ai-pop-select" },
      onClick: () => {
        const row = s.tray.errors.find((r) => r.index === index || r.item.original === err.original);
        if (!row || row.saved) { showToast(row?.saved ? "Lỗi này đã được lưu." : "Lỗi này trùng một lỗi khác trong khay.", "ok"); return; }
        row.checked = true;
        renderTray();
        const el = s.refs.tray.querySelector(`.ai-row[data-kind="error"][data-index="${row.index}"]`);
        el?.scrollIntoView({ block: "center" });
        el?.querySelector("input")?.focus();
      },
    }, "Chọn để lưu vào sổ tay"));
  pop.hidden = false;
}

function comparePanel(result) {
  const { wrong, right } = diffWords(s.text, result.minimalCorrectedText, { maxCells: COMPARE_MAX_CELLS });
  const run = (tokens, cls) => tokens.flatMap((t, i) => [i ? " " : "", t.changed ? h("span", { class: cls }, t.text) : t.text]);
  return h("div", { class: "ai-panel", dataset: { panel: "cmp" } },
    h("p", { class: "form-hint" }, "Chỉ sửa lỗi, giữ nguyên ý và từ của bạn. Cách diễn đạt hay hơn nằm ở tab Bản Band 7.0+."),
    h("div", { class: "ai-compare" },
      h("section", {}, h("h3", { class: "ai-compare-title" }, "Bài gốc"), h("p", { class: "ai-compare-text", dataset: { role: "ai-cmp-wrong" } }, ...run(wrong, "ai-del"))),
      h("section", {}, h("h3", { class: "ai-compare-title" }, "Bản sửa tối thiểu"), h("p", { class: "ai-compare-text", dataset: { role: "ai-cmp-right" } }, ...run(right, "ai-ins")))));
}

function band7Panel(result) {
  return h("div", { class: "ai-panel", dataset: { panel: "b7" } },
    h("p", { class: "form-hint" }, "Bản viết lại tham khảo ở mức Band 7.0+, giữ ý của bạn. Đây không phải bản sửa lỗi và không phải bài mẫu chính thức."),
    h("p", { class: "ai-band7-text", dataset: { role: "ai-band7" } }, result.band7Text));
}

// ---- The two trays and the save bar ----
const selectedRows = () => [...s.tray.errors, ...s.tray.vocab].filter((r) => r.checked && !r.saved);

function trayRow(row) {
  const check = h("input", { type: "checkbox", checked: row.checked && !row.saved, disabled: row.saved, dataset: { role: "ai-check" }, "aria-label": row.kind === "error" ? `Lưu lỗi: ${row.item.original}` : `Lưu từ: ${row.item.word}` });
  check.addEventListener("change", () => { row.checked = check.checked; refreshSaveBar(); });
  const it = row.item;
  const tag = h("span", { class: `ai-tag${row.saved ? " is-saved" : row.existing ? " is-known" : " is-new"}`, dataset: { role: "ai-label" } }, row.label);
  const body = row.kind === "error"
    ? [
      h("p", { class: "ai-row-title" }, h("span", { class: "ai-pop-wrong" }, it.original), " → ", h("strong", {}, it.corrected)),
      h("p", { class: "ai-row-meta" }, `${errorTypeLabel(it.type)} · ${it.signature}`),
      h("p", { class: "ai-row-text" }, it.explanationVi),
    ]
    : [
      h("p", { class: "ai-row-title" }, h("strong", {}, it.word), ` · ${it.pos}`, it.ipa ? ` · ${it.ipa}` : ""),
      h("p", { class: "ai-row-text" }, it.meaningVi),
      it.collocations.length ? h("p", { class: "ai-row-meta" }, it.collocations.join(" · ")) : null,
    ];
  const sev = row.kind === "error" ? h("span", { class: "ai-tag ai-sev", dataset: { severity: it.severity } }, SEVERITY_LABEL[it.severity]) : null;
  return h("label", { class: "ai-row", dataset: { kind: row.kind, index: String(row.index), saved: String(row.saved) } },
    check, h("div", { class: "ai-row-body" }, h("div", { class: "ai-row-tags" }, tag, sev), ...body.filter(Boolean)));
}

function renderTray() {
  const box = s.refs.tray;
  const section = (title, rows, role, empty) => h("section", { class: "ai-tray", dataset: { role } },
    h("h3", { class: "ai-tray-title" }, `${title} (${rows.length})`),
    rows.length ? h("div", { class: "ai-rows" }, ...rows.map(trayRow)) : h("p", { class: "muted" }, empty));
  box.replaceChildren(
    section("Lỗi phát hiện", s.tray.errors, "ai-tray-errors", "Claude không thấy lỗi nào."),
    section("Từ vựng nên học", s.tray.vocab, "ai-tray-vocab", "Claude không gợi ý từ nào."));
  refreshSaveBar();
}

function refreshSaveBar() {
  if (!s.refs.save) return;
  const n = selectedRows().length;
  s.refs.save.textContent = `Lưu đã chọn (${n} mục)`;
  s.refs.save.disabled = s.saving || (n === 0 && !(s.refs.bandCheck?.checked));
}

function saveBar(result) {
  const info = overallInfo(result);
  const hasTest = Boolean(s.source.book);
  const where = s.mode === "speaking" ? "ô S" : `ô W Task ${s.source.task}`;
  const bandCheck = h("input", { type: "checkbox", checked: hasTest, disabled: !hasTest, dataset: { role: "ai-band-check" }, id: "ai-band-check" });
  bandCheck.addEventListener("change", refreshSaveBar);
  s.refs.bandCheck = bandCheck;
  s.refs.save = h("button", { type: "button", class: "btn btn-primary", dataset: { role: "ai-save" }, onClick: onSave }, "Lưu đã chọn (0 mục)");
  return h("div", { class: "ai-savebar" },
    h("label", { class: "ai-band-line", for: "ai-band-check" }, bandCheck,
      h("span", {}, hasTest
        ? `Ghi Band ${formatBand(info.computed)} vào ${where} của Cam ${s.source.book} Test ${s.source.test}`
        : "Chọn Cam và Test ở trên nếu muốn ghi band vào ma trận")),
    s.refs.save);
}

function renderResult() {
  const result = s.result;
  s.root.dataset.hasResult = "true";
  s.tray = buildTray(result, { errors: s.data.errors, vocab: s.data.vocab, occurrences: s.data.occurrences, saved: s.sub?.saved });
  const panels = { hl: highlightPanel(result), cmp: comparePanel(result), b7: band7Panel(result) };
  const tabs = h("div", { class: "seg ai-tabs", role: "tablist", "aria-label": "Cách xem kết quả" },
    [["hl", "Bài gốc có highlight"], ["cmp", "So sánh gốc–sửa"], ["b7", "Bản Band 7.0+"]].map(([id, label]) => h("button", {
      type: "button", class: "seg-btn", role: "tab", dataset: { tab: id },
      "aria-selected": String(s.tab === id),
      onClick: () => { s.tab = id; showTab(); },
    }, label)));
  const holder = h("div", { class: "ai-panels" }, ...Object.values(panels));
  s.refs.tabs = tabs;
  s.refs.panels = holder;
  s.refs.tray = h("div", { class: "ai-trays" });
  s.refs.result.replaceChildren(
    overallBlock(result),
    h("ul", { class: "ai-criteria" }, ...CRITERIA[result.task].map((k) => criterionCard(k, result))),
    tabs, holder, s.refs.tray, saveBar(result));
  s.refs.result.hidden = false;
  showTab();
  renderTray();
}

function showTab() {
  for (const b of s.refs.tabs.children) b.setAttribute("aria-selected", String(b.dataset.tab === s.tab));
  for (const p of s.refs.panels.children) p.hidden = p.dataset.panel !== s.tab;
}

async function onSave() {
  if (s.saving) return;
  s.saving = true;
  refreshSaveBar();
  const x = s;
  try {
    await flushSave();
    if (!x.sub?.id) throw new Error("Chưa có bài để lưu.");
    const rows = selectedRows();
    const errors = rows.filter((r) => r.kind === "error");
    const vocab = rows.filter((r) => r.kind === "vocab");
    let writeBand = Boolean(x.refs.bandCheck?.checked);
    let bandKept = false;
    if (writeBand) {
      const plan = await planBand(x.sub);
      const { computed } = overallInfo(x.result);
      const old = plan?.existing;
      if (plan && old && typeof old.band === "number" && !(old.submissionId === x.sub.id && old.band === computed)) {
        const ok = await confirmModal({
          title: "Ghi đè band đã có?",
          message: `${x.mode === "speaking" ? "Ô S" : `Ô W Task ${plan.task}`} của Cam ${plan.book} Test ${plan.test} đang có Band ${formatBand(old.band)}. Ghi đè bằng Band ${formatBand(computed)}?`,
          confirmLabel: "Ghi đè",
        });
        if (!ok) { writeBand = false; bandKept = true; }
      }
    }
    if (s !== x) return;
    const res = await saveAnalysis({ sub: x.sub, result: x.result, errors, vocab, writeBand });
    x.data = await loadStudioData();
    x.sub = x.data.submissions.find((r) => r.id === x.sub.id) ?? x.sub;
    document.dispatchEvent(new CustomEvent("elh:data-changed"));
    const parts = [];
    if (res.errors) parts.push(`${res.errors} lỗi${res.mergedErrors ? ` (${res.mergedErrors} cộng vào lỗi có sẵn)` : ""}`);
    if (res.vocab) parts.push(`${res.vocab} từ${res.mergedVocab ? ` (${res.mergedVocab} đã có thẻ)` : ""}`);
    let msg = parts.length ? `Đã lưu ${parts.join(", ")}` : "Đã lưu kết quả phân tích";
    if (res.band !== null) msg += ` · Band ${formatBand(res.band)} đã ghi vào ma trận`;
    else if (bandKept) msg += " · Band giữ nguyên";
    showToast(msg);
    if (s === x) renderResult();
  } catch (e) {
    showToast(e.message || "Không lưu được.", "error");
  } finally {
    x.saving = false;
    if (s === x) refreshSaveBar();
  }
}

// ---- Copy prompt / paste JSON ----
async function onAnalyze() {
  if (!s.text.trim()) {
    showToast(s.mode === "speaking" ? "Hãy gõ transcript câu trả lời trước." : "Hãy viết hoặc dán bài viết trước.", "error");
    s.refs.text.focus();
    return;
  }
  if (s.mode === "writing" && !s.prompt.trim()) {
    showToast("Hãy gõ đề bài: Claude cần đề để chấm Task Achievement / Task Response.", "error");
    s.refs.prompt.focus();
    return;
  }
  const x = s;
  try {
    await flushSave();
    if (s !== x) return;
    const task = currentTask();
    const session = startTask(task, {
      questionText: x.prompt, text: x.text, wordCount: countWords(x.text),
      taskType: x.mode === "writing" ? x.taskType : "", part: x.mode === "speaking" ? x.source.part : null,
      signatures: knownSignatures(x.data.errors),
    });
    const cp = createCopyPaste({
      prompt: session.prompt, prefix: "ai",
      before: task === "writing_task1"
        ? [h("p", { class: "ai-reminder-strong", dataset: { role: "ai-image-reminder-step" } }, "Nhớ đính kèm ảnh biểu đồ khi dán prompt vào Claude. App không lưu ảnh.")]
        : [],
    });
    const read = h("button", {
      type: "button", class: "btn btn-primary", dataset: { role: "ai-read" },
      onClick: () => {
        try {
          x.result = session.accept(cp.getText());
          x.tab = "hl";
          renderResult();
          x.refs.result.scrollIntoView({ block: "start" });
        } catch (e) {
          cp.showError(e instanceof AiFormatError ? e.message : "Không đọc được câu trả lời.");
        }
      },
    }, "Đọc JSON");
    x.refs.panel.replaceChildren(cp.node, h("div", { class: "ai-panel-actions" }, read));
    x.refs.panel.hidden = false;
    cp.node.scrollIntoView({ block: "nearest" });
  } catch (e) {
    showToast(e.message || "Không tạo được prompt.", "error");
  }
}

// ---- Page ----
function buildForm() {
  const x = s;
  const isW = x.mode === "writing";
  const pieces = pickerSubmissions(x.data.submissions, x.mode);
  const picker = h("select", { id: "ai-picker", class: "input", dataset: { role: "ai-picker" },
    onChange: () => { location.hash = picker.value ? `#/ai/${x.mode}?id=${picker.value}` : `#/ai/${x.mode}`; } },
  optionEl("", "Bài mới", !x.id), ...pieces.map((p) => optionEl(p.id, submissionLabel(p), p.id === x.id)));

  const book = h("select", { id: "ai-book", class: "input", dataset: { role: "ai-book" } },
    optionEl("", "Không gắn test", !x.source.book), ...[...BOOKS].reverse().map((b) => optionEl(b, `Cam ${b}`, x.source.book === b)));
  const test = h("select", { id: "ai-test", class: "input", dataset: { role: "ai-test" }, disabled: !x.source.book },
    ...[1, 2, 3, 4].map((t) => optionEl(t, `Test ${t}`, x.source.test === t)));
  const task = isW ? h("select", { id: "ai-task", class: "input", dataset: { role: "ai-task" } },
    ...[1, 2].map((t) => optionEl(t, `Task ${t}`, x.source.task === t))) : null;
  const part = !isW ? h("select", { id: "ai-part", class: "input", dataset: { role: "ai-part" } },
    ...[1, 2, 3].map((t) => optionEl(t, `Part ${t}`, x.source.part === t))) : null;
  const type = isW ? h("select", { id: "ai-tasktype", class: "input", dataset: { role: "ai-tasktype" } }) : null;
  const fillTypes = () => {
    type.replaceChildren(optionEl("", "Chưa chọn", !x.taskType), ...(WRITING_TASK_TYPES[x.source.task] ?? []).map((t) => optionEl(t, t, x.taskType === t)));
    if (x.taskType && !(WRITING_TASK_TYPES[x.source.task] ?? []).includes(x.taskType)) x.taskType = "";
  };

  const reminder = isW ? h("p", { class: "ai-reminder", dataset: { role: "ai-image-reminder" }, hidden: x.source.task !== 1 },
    "Nhớ đính kèm ảnh biểu đồ khi dán prompt vào Claude. App không lưu ảnh; Claude dùng ảnh để kiểm tra số liệu và overview.") : null;

  const prompt = h("textarea", { id: "ai-prompt", class: "input textarea ai-textarea", rows: "3", dataset: { role: "ai-prompt" },
    placeholder: isW ? "Gõ hoặc dán đề bài từ sách của bạn" : "Gõ câu hỏi của giám khảo" });
  prompt.value = x.prompt;
  const text = h("textarea", { id: "ai-text", class: "input textarea ai-textarea ai-main-text", rows: "12", dataset: { role: "ai-text" },
    placeholder: isW ? "Bài viết của bạn" : "Transcript câu trả lời của bạn (tự gõ lại)", spellcheck: "false" });
  text.value = x.text;
  const count = h("span", { class: "ai-count nowrap", dataset: { role: "ai-count" } });
  const updateCount = () => { const n = countWords(x.text); count.textContent = `${n} từ`; };
  updateCount();

  book.addEventListener("change", () => { x.source.book = book.value ? Number(book.value) : ""; test.disabled = !x.source.book; scheduleSave(); });
  test.addEventListener("change", () => { x.source.test = Number(test.value); scheduleSave(); });
  task?.addEventListener("change", () => { x.source.task = Number(task.value); fillTypes(); reminder.hidden = x.source.task !== 1; scheduleSave(); });
  part?.addEventListener("change", () => { x.source.part = Number(part.value); scheduleSave(); });
  type?.addEventListener("change", () => { x.taskType = type.value; scheduleSave(); });
  prompt.addEventListener("input", () => { x.prompt = prompt.value; scheduleSave(); });
  text.addEventListener("input", () => { x.text = text.value; updateCount(); scheduleSave(); });
  if (type) fillTypes();

  x.refs = { ...x.refs, text, prompt, panel: h("div", { class: "ai-copy-panel", hidden: true, dataset: { role: "ai-panel" } }), result: h("section", { class: "ai-result", hidden: true, dataset: { role: "ai-result" }, "aria-label": "Kết quả của Claude" }) };

  return h("section", { class: "ai-input", "aria-label": "Bài của bạn" },
    field("Bài đã lưu", picker, "ai-picker"),
    h("div", { class: "ai-source" },
      field("Cam", book, "ai-book"), field("Test", test, "ai-test"),
      isW ? field("Task", task, "ai-task") : field("Part", part, "ai-part"),
      isW ? field("Dạng bài", type, "ai-tasktype") : null),
    reminder,
    field(isW ? "Đề bài (bạn tự gõ, chỉ lưu trong dữ liệu riêng của bạn)" : "Câu hỏi (bạn tự gõ, chỉ lưu trong dữ liệu riêng của bạn)", prompt, "ai-prompt"),
    h("div", { class: "field" },
      h("div", { class: "ai-text-head" }, h("label", { class: "field-label", for: "ai-text" }, isW ? "Bài viết" : "Transcript"), count),
      text),
    isW ? null : h("p", { class: "form-hint" }, "App không chấm được phát âm thật từ văn bản: điểm P chỉ là ước lượng."),
    h("div", { class: "ai-analyze" },
      h("button", { type: "button", class: "btn btn-primary", dataset: { role: "ai-analyze" }, onClick: onAnalyze }, "Phân tích với Claude")),
    x.refs.panel);
}

async function start(container, mode, query) {
  const x = {
    mode, container, root: null, refs: {}, id: null, sub: null, data: null, result: null, tab: "hl", tray: null, saving: false,
    source: { book: "", test: 1, task: 2, part: 1 }, taskType: "", prompt: "", text: "", saveTimer: null, chain: Promise.resolve(),
  };
  s = x;
  container.replaceChildren(h("p", { class: "muted" }, "Đang tải…"));
  try {
    x.data = await loadStudioData();
  } catch (err) {
    if (s === x) container.replaceChildren(h("p", { class: "form-error" }, `Không đọc được dữ liệu: ${err.message}`));
    return;
  }
  if (s !== x) return;

  const sub = query?.id ? x.data.submissions.find((r) => r.id === query.id && !r.deleted) : null;
  if (query?.id && !sub) showToast("Không tìm thấy bài này.", "error");
  if (sub && sub.kind !== mode) { location.replace(`#/ai/${sub.kind}?id=${sub.id}`); return; }
  if (sub) {
    x.id = sub.id;
    x.sub = sub;
    x.source = {
      book: sub.source?.book ?? "", test: sub.source?.test ?? 1,
      task: sub.source?.task === 1 ? 1 : 2, part: [1, 2, 3].includes(sub.source?.part) ? sub.source.part : 1,
    };
    x.taskType = sub.taskType ?? "";
    x.prompt = sub.prompt ?? "";
    x.text = sub.text ?? "";
  }

  const modes = h("div", { class: "seg ai-modes", role: "tablist", "aria-label": "Writing hoặc Speaking" },
    h("a", { class: "seg-btn", role: "tab", href: "#/ai/writing", "aria-selected": String(mode === "writing"), dataset: { mode: "writing" } }, "Writing"),
    h("a", { class: "seg-btn", role: "tab", href: "#/ai/speaking", "aria-selected": String(mode === "speaking"), dataset: { mode: "speaking" } }, "Speaking"));
  const form = buildForm();
  x.root = h("div", { class: "ai", dataset: { mode, hasResult: "false" } },
    h("h1", { class: "page-title" }, "Writing & Speaking AI"),
    h("p", { class: "page-sub" }, "Gõ bài của bạn, sao chép prompt sang Claude, rồi dán JSON trả về để xem lỗi và từ cần học."),
    modes,
    h("div", { class: "ai-layout" }, form, x.refs.result));
  container.replaceChildren(x.root);

  if (sub?.status === "analyzed" && sub.result) {
    x.result = sub.result;
    renderResult();
  }
}

function stop() {
  if (!s) return;
  const x = s;
  clearTimeout(x.saveTimer);
  if (x.text.trim() || x.id) flushSave().catch(() => {}); // leaving: do not lose the last words
  s = null;
}

const studioView = (mode) => ({
  mount(container, _params, query = {}) {
    stop();
    start(container, mode, query);
  },
  unmount: stop,
});

export const aiWritingView = studioView("writing");
export const aiSpeakingView = studioView("speaking");
