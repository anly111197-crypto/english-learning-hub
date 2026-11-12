// "Sao lưu JSON" / "Khôi phục" buttons, restore dialog and a small status line.
import { exportAll, importData, readBackupFile, countRecords, hasLocalData } from "../services/backup.js";
import { validateBackup } from "../services/merge.js";

let statusEl = null;
let statusTimer = null;

export function showStatus(message, kind = "ok") {
  if (!statusEl) {
    statusEl = document.createElement("div");
    statusEl.className = "status-line";
    statusEl.setAttribute("role", "status");
    document.body.append(statusEl);
  }
  statusEl.textContent = message;
  statusEl.dataset.kind = kind;
  statusEl.hidden = false;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { statusEl.hidden = true; }, kind === "error" ? 9000 : 5000);
}

// Resolves "replace" | "merge" | "cancel". The quick-capture FAB is hidden while the dialog is open.
function askRestoreMode(fileName, recordCount, willBackupFirst) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "dialog";
    dlg.innerHTML = `
      <form method="dialog">
        <h2 class="dialog-title">Khôi phục từ tệp sao lưu</h2>
        <p class="dialog-file nowrap"></p>
        <p><strong>Thay thế:</strong> xoá dữ liệu hiện tại, dùng đúng dữ liệu trong tệp.</p>
        <p><strong>Gộp:</strong> giữ cả hai, bản ghi nào mới hơn thì thắng.</p>
        <p class="dialog-note" hidden>Dữ liệu hiện tại sẽ được tải xuống thành một tệp sao lưu trước khi thay đổi.</p>
        <div class="dialog-actions">
          <button class="btn btn-primary" value="replace">Thay thế</button>
          <button class="btn btn-outline" value="merge">Gộp</button>
          <button class="btn btn-text" value="cancel">Huỷ</button>
        </div>
      </form>`;
    dlg.querySelector(".dialog-file").textContent = `${fileName} · ${recordCount} bản ghi`;
    dlg.querySelector(".dialog-note").hidden = !willBackupFirst; // only when there is data to protect
    dlg.addEventListener("close", () => {
      delete document.body.dataset.overlayOpen;
      dlg.remove();
      resolve(dlg.returnValue || "cancel");
    });
    document.body.append(dlg);
    document.body.dataset.overlayOpen = "";
    dlg.showModal();
  });
}

async function handleRestore(file) {
  try {
    const json = await readBackupFile(file);
    const data = validateBackup(json); // clear error before asking anything
    const mode = await askRestoreMode(file.name, countRecords(data), await hasLocalData());
    if (mode === "cancel") return;
    const result = await importData(json, mode);
    document.dispatchEvent(new CustomEvent("elh:data-changed"));
    const how = mode === "replace" ? "Đã thay thế" : "Đã gộp";
    const saved = result.safetyBackup ? ` Bản cũ đã tải xuống: ${result.safetyBackup}.` : "";
    showStatus(`${how} dữ liệu: ${result.records} bản ghi.${saved}`);
  } catch (e) {
    showStatus(e.message || "Không khôi phục được.", "error");
  }
}

const icon = (id) => `<svg class="icon"><use href="#${id}"/></svg>`;

export function mountBackupControls(container, variant = "navy") {
  const cls = variant === "navy" ? "btn btn-navy" : "btn btn-outline";
  container.innerHTML = `
    <div class="backup-controls">
      <button type="button" class="${cls}" data-act="backup" title="Sao lưu JSON">${icon("i-download")}<span class="backup-label nowrap">Sao lưu JSON</span></button>
      <button type="button" class="${cls}" data-act="restore" title="Khôi phục">${icon("i-upload")}<span class="backup-label nowrap">Khôi phục</span></button>
      <input type="file" accept="application/json,.json" hidden>
    </div>`;
  const input = container.querySelector("input[type=file]");
  container.querySelector('[data-act="backup"]').addEventListener("click", async () => {
    try {
      const { filename } = await exportAll();
      showStatus(`Đã tải ${filename}`);
    } catch (e) {
      showStatus(e.message || "Không sao lưu được.", "error");
    }
  });
  container.querySelector('[data-act="restore"]').addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files[0];
    input.value = "";
    if (file) await handleRestore(file);
  });
}
