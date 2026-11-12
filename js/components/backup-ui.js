// "Sao lưu JSON" / "Khôi phục" buttons, restore dialog and a small status line.
import { exportAll, importData, readBackupFile, countRecords, hasLocalData, backupInfo } from "../services/backup.js";
import { backupStatus } from "../services/dashboard-stats.js";
import { isoDate } from "../services/leitner.js";
import { validateBackup } from "../services/merge.js";
import { showToast as showStatus } from "./toast.js";
import { overlayOpened, overlayClosed } from "./overlay.js";

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
      overlayClosed();
      dlg.remove();
      resolve(dlg.returnValue || "cancel");
    });
    document.body.append(dlg);
    overlayOpened();
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
    </div>
    <p class="backup-status" role="status" data-level="none"></p>`;
  const input = container.querySelector("input[type=file]");
  const statusEl = container.querySelector(".backup-status");

  // "Sao lưu lần cuối: …", orange when it is over 3 days old and something changed since.
  async function refreshStatus() {
    try {
      const s = backupStatus({ ...(await backupInfo()), today: isoDate() });
      statusEl.textContent = s.text;
      statusEl.dataset.level = s.level;
    } catch { /* the line is optional */ }
  }
  // Refresh after data changes, after a backup, and whenever the learner moves to another page
  // (many screens write data without announcing it).
  const events = [["document", "elh:data-changed"], ["document", "elh:backup-done"], ["window", "hashchange"]];
  const target = (name) => (name === "window" ? window : document);
  const onChange = () => {
    if (!container.isConnected) {
      for (const [t, ev] of events) target(t).removeEventListener(ev, onChange);
      return;
    }
    refreshStatus();
  };
  for (const [t, ev] of events) target(t).addEventListener(ev, onChange);
  refreshStatus();
  container.querySelector('[data-act="backup"]').addEventListener("click", async () => {
    try {
      const { filename } = await exportAll();
      showStatus(`Đã tải ${filename}`);
      document.dispatchEvent(new CustomEvent("elh:backup-done"));
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
