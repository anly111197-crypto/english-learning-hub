// Cambridge Practice · Notebook & tài liệu (spec 5.3): 6 notebook cards, paste an answer from NotebookLM,
// notes attached to tests, words and errors. No sync: only links and text the learner provides.
import { h, formatDateVi } from "../components/dom.js";
import { confirmModal } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import { renderPracticeHeader } from "./practice.js";
import { loadNotebookData, notesFor, deleteNote } from "../services/notebook-ops.js";
import { isHttpsUrl } from "../services/practice-store.js";
import { openPasteModal, openNotebookEditModal } from "./notebook-forms.js";

const state = { active: false, container: null, data: null, token: 0, grid: null };

const preview = (note) => {
  const s = (note.text || note.example || note.citation || "").replace(/\s+/g, " ");
  return s.length > 140 ? s.slice(0, 139) + "…" : s;
};

function notebookCard(nb) {
  const mine = notesFor(state.data.notes, "notebook", nb.id);
  const link = isHttpsUrl(nb.notebookUrl) ? nb.notebookUrl : null;
  const noteItem = (note) => {
    const attached = (note.links ?? []).filter((l) => l.type !== "notebook").length;
    return h("li", { class: "notebook-note" },
      h("p", { class: "notebook-note-text" }, preview(note)),
      h("p", { class: "notebook-note-meta muted" },
        formatDateVi(String(note.createdAt ?? "").slice(0, 10)), attached ? ` · gắn vào ${attached} mục` : "",
        h("button", { type: "button", class: "btn btn-text btn-sm", onClick: async () => {
          const ok = await confirmModal({ title: "Xoá note", danger: true, confirmLabel: "Xoá", message: "Xoá note này?" });
          if (!ok) return;
          await deleteNote(note.id);
          showToast("Đã xoá note.");
          await reload();
        } }, "Xoá")));
  };

  return h("article", { class: "notebook-card" },
    h("div", { class: "notebook-head" },
      h("h2", { class: "notebook-name", title: nb.name }, nb.name),
      h("span", { class: "chip nowrap" }, `${nb.sourceCount ?? 0} nguồn`)),
    h("p", { class: "notebook-purpose" }, nb.purpose || "Chưa có mục đích."),
    h("div", { class: "notebook-notes" },
      h("p", { class: "summary-label" }, `${mine.length} note`),
      mine.length ? h("ul", { class: "notebook-note-list" }, mine.slice(0, 3).map(noteItem)) : h("p", { class: "muted" }, "Chưa có note.")),
    h("div", { class: "notebook-actions" },
      link ? h("a", { class: "btn btn-outline", href: link, target: "_blank", rel: "noopener noreferrer" }, "Mở trong NotebookLM") : null,
      h("button", { type: "button", class: "btn btn-outline", onClick: () => openNotebookEditModal({ notebook: nb, onSaved: reload }) }, "Sửa")));
}

function renderGrid() {
  state.grid.replaceChildren(...state.data.notebooks.map(notebookCard));
}

async function reload() {
  state.data = await loadNotebookData();
  if (state.active) renderGrid();
}

document.addEventListener("elh:data-changed", () => { if (state.active && state.data) reload().catch(() => {}); });

export const practiceNotebooksView = {
  mount(container) {
    state.active = true;
    state.container = container;
    state.data = null;
    const token = ++state.token;

    const root = h("div", { class: "practice" });
    renderPracticeHeader(root, "notebooks");
    state.grid = h("div", { class: "notebook-grid" }, h("p", { class: "muted" }, "Đang tải…"));
    const pasteBtn = h("button", { type: "button", class: "btn btn-primary", disabled: true, onClick: () => openPasteModal({ notebooks: state.data.notebooks, onSaved: reload }) }, "Dán kết quả từ NotebookLM");
    root.append(
      h("div", { class: "notebook-toolbar" },
        h("p", { class: "notebook-intro" }, "NotebookLM / Gemini Notebook của bạn. Ứng dụng chỉ lưu link bạn dán và các note bạn tự dán vào, không đồng bộ nguồn."),
        pasteBtn),
      state.grid);
    container.replaceChildren(root);

    loadNotebookData().then((data) => {
      if (token !== state.token) return;
      state.data = data;
      pasteBtn.disabled = false;
      renderGrid();
    }).catch((err) => {
      if (token !== state.token) return;
      state.grid.replaceChildren(h("p", { class: "form-error" }, `Không đọc được dữ liệu: ${err.message}`));
    });
  },

  unmount() {
    state.active = false;
    state.token++;
  },
};
