// Forms of the Notebook tab: paste an answer from NotebookLM / Gemini Notebook, and edit a notebook card.
import { openModal } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import { h } from "../components/dom.js";
import { list } from "../services/repo.js";
import { parseNotebookText, searchTargets } from "../services/notebook-text.js";
import { saveNote, updateNotebook } from "../services/notebook-ops.js";

const KIND_LABELS = { test: "Test", vocab: "Từ", error: "Lỗi" };
const LAST_KEY = "lastNotebook";

const field = (label, el, id, hint) => h("div", { class: "field" },
  h("label", { class: "field-label", for: id }, label), el, hint ? h("p", { class: "form-hint" }, hint) : null);

function rememberedNotebook() {
  try { return localStorage.getItem(LAST_KEY); } catch { return null; }
}

// Paste -> split into KIẾN THỨC / VÍ DỤ / NGUỒN -> choose the notebook -> optionally attach to tests, words, errors.
export async function openPasteModal({ notebooks, onSaved }) {
  const [vocab, errors] = await Promise.all([list("vocab"), list("errors")]);
  const links = []; // { type, id, label }

  const paste = h("textarea", { id: "pn-paste", class: "input textarea paste-box", rows: "6", placeholder: "Dán câu trả lời từ NotebookLM / Gemini Notebook vào đây", autofocus: true });
  const text = h("textarea", { id: "pn-text", class: "input textarea", rows: "3" });
  const example = h("textarea", { id: "pn-example", class: "input textarea", rows: "3" });
  const citation = h("textarea", { id: "pn-citation", class: "input textarea", rows: "2" });
  paste.addEventListener("input", () => {
    const r = parseNotebookText(paste.value);
    text.value = r.text;
    example.value = r.example;
    citation.value = r.citation;
    hint.textContent = !paste.value.trim()
      ? ""
      : r.hasLabels ? "Đã tách theo nhãn KIẾN THỨC / VÍ DỤ / NGUỒN. Bạn có thể sửa từng ô." : "Không thấy nhãn nên toàn bộ đoạn được đưa vào KIẾN THỨC.";
  });
  const hint = h("p", { class: "form-hint", "aria-live": "polite" });

  const remembered = rememberedNotebook();
  const notebook = h("select", { id: "pn-notebook", class: "input" },
    notebooks.map((n) => h("option", { value: n.id, selected: n.id === remembered ? true : null }, n.name)));

  // attach to ...
  const search = h("input", { id: "pn-search", class: "input", type: "search", placeholder: "Tìm test, từ hoặc lỗi…", autocomplete: "off" });
  const results = h("div", { class: "target-results", role: "listbox", "aria-label": "Kết quả tìm" });
  const chips = h("div", { class: "link-chips" });

  function renderChips() {
    chips.replaceChildren(...links.map((l, i) => h("span", { class: "link-chip" },
      h("span", { class: "nowrap" }, `${KIND_LABELS[l.type]}: `), l.label,
      h("button", { type: "button", class: "chip-x", "aria-label": `Bỏ ${l.label}`, onClick: () => { links.splice(i, 1); renderChips(); } }, "×"))));
  }
  function addLink(t) {
    if (!links.some((l) => l.type === t.type && l.id === t.id)) links.push({ type: t.type, id: t.id, label: t.label });
    search.value = "";
    renderResults();
    renderChips();
  }
  function renderResults() {
    const found = searchTargets(search.value, { vocab, errors });
    results.replaceChildren(...found.map((t) => h("button", { type: "button", class: "target-item", role: "option", onClick: () => addLink(t) },
      h("span", { class: "tag nowrap" }, KIND_LABELS[t.type]), h("span", { class: "target-label" }, t.label),
      t.hint ? h("span", { class: "muted target-hint" }, t.hint) : null)));
    results.hidden = found.length === 0;
  }
  search.addEventListener("input", renderResults);
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = searchTargets(search.value, { vocab, errors })[0];
      if (first) addLink(first);
    }
  });
  results.hidden = true;

  const error = h("p", { class: "form-error", role: "alert", hidden: true });

  async function submit(e) {
    e.preventDefault();
    error.hidden = true;
    try {
      await saveNote({
        notebookId: notebook.value, text: text.value, example: example.value, citation: citation.value,
        links: links.map(({ type, id }) => ({ type, id })),
      });
    } catch (err) {
      error.textContent = err.message || "Không lưu được.";
      error.hidden = false;
      return;
    }
    try { localStorage.setItem(LAST_KEY, notebook.value); } catch { /* storage unavailable */ }
    modal.close();
    showToast(`Đã lưu note vào ${notebooks.find((n) => n.id === notebook.value)?.name ?? "notebook"}.`);
    document.dispatchEvent(new CustomEvent("elh:data-changed"));
    await onSaved?.();
  }

  const form = h("form", { id: "paste-form", class: "form", novalidate: true, onSubmit: submit },
    field("Dán kết quả", paste, "pn-paste"), hint,
    field("KIẾN THỨC", text, "pn-text"),
    field("VÍ DỤ", example, "pn-example"),
    field("NGUỒN", citation, "pn-citation"),
    field("Lưu vào notebook", notebook, "pn-notebook"),
    field("Gắn vào test / từ / lỗi (không bắt buộc)", search, "pn-search"), results, chips,
    error);
  const footer = h("div", { class: "modal-actions" },
    h("button", { type: "button", class: "btn btn-text", onClick: () => modal.close() }, "Hủy"),
    h("button", { type: "submit", form: "paste-form", class: "btn btn-primary" }, "Lưu note"));
  const modal = openModal({ title: "Dán kết quả từ NotebookLM", content: form, footer });
  paste.focus();
  return modal;
}

export function openNotebookEditModal({ notebook, onSaved }) {
  const name = h("input", { id: "nb-name", class: "input", type: "text", value: notebook.name ?? "", autocomplete: "off" });
  const purpose = h("textarea", { id: "nb-purpose", class: "input textarea", rows: "3" }, notebook.purpose ?? "");
  const count = h("input", { id: "nb-count", class: "input", type: "number", inputmode: "numeric", min: "0", step: "1", value: notebook.sourceCount ?? 0 });
  const url = h("input", { id: "nb-url", class: "input", type: "url", inputmode: "url", placeholder: "https://…", value: notebook.notebookUrl ?? "", autocomplete: "off" });
  const error = h("p", { class: "form-error", role: "alert", hidden: true });

  async function submit(e) {
    e.preventDefault();
    error.hidden = true;
    try {
      await updateNotebook(notebook.id, { name: name.value, purpose: purpose.value, sourceCount: count.value, notebookUrl: url.value });
    } catch (err) {
      error.textContent = err.message || "Không lưu được.";
      error.hidden = false;
      return;
    }
    modal.close();
    showToast("Đã lưu notebook.");
    await onSaved?.();
  }

  const form = h("form", { id: "nb-form", class: "form", novalidate: true, onSubmit: submit },
    field("Tên", name, "nb-name"),
    field("Mục đích", purpose, "nb-purpose"),
    field("Số nguồn (bạn tự nhập)", count, "nb-count", "Ứng dụng không đọc được notebook của bạn nên con số này do bạn nhập."),
    field("Link notebook", url, "nb-url", "Link NotebookLM / Gemini Notebook, phải bắt đầu bằng https://"),
    error);
  const footer = h("div", { class: "modal-actions" },
    h("button", { type: "button", class: "btn btn-text", onClick: () => modal.close() }, "Hủy"),
    h("button", { type: "submit", form: "nb-form", class: "btn btn-primary" }, "Lưu"));
  const modal = openModal({ title: `Sửa notebook · ${notebook.group}`, content: form, footer });
  return modal;
}
