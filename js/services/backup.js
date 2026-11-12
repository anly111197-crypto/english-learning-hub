// JSON backup / restore (spec 7.2). Pure merge logic lives in merge.js.
import { exportRaw, replaceAllRaw } from "./repo.js";
import { APP_ID, SCHEMA_VERSION, STORE_NAMES } from "./schema.js";
import { planImport } from "./merge.js";
import { downloadText } from "../components/download.js";

export function backupFilename(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `elh-backup-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}.json`;
}

// The backup object for the current database (tombstones included).
export async function buildBackup() {
  return {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: await exportRaw(),
  };
}

export async function exportAll() {
  const backup = await buildBackup();
  const filename = backupFilename();
  downloadText(filename, JSON.stringify(backup, null, 2));
  try { localStorage.setItem("lastBackupAt", backup.exportedAt); } catch { /* storage unavailable */ }
  return { filename, backup };
}

export async function readBackupFile(file) {
  let json;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new Error("Tệp không phải JSON hợp lệ.");
  }
  return json;
}

// True when any store holds a record (tombstones included), i.e. an import would change real data.
export async function hasLocalData() {
  const data = await exportRaw();
  return STORE_NAMES.some((s) => data[s].length > 0);
}

export function countRecords(data) {
  return STORE_NAMES.reduce((sum, s) => sum + (data[s] ?? []).filter((r) => !r.deleted).length, 0);
}

// mode: "replace" | "merge". Validation and planning happen first; nothing is written if they throw.
// The current data is downloaded as a backup before being changed (skipped when the database is empty
// or options.autoBackup === false).
export async function importData(json, mode, { autoBackup = true } = {}) {
  const local = await exportRaw();
  const next = planImport(local, json, mode); // throws BackupError, DB untouched
  const hadData = STORE_NAMES.some((s) => local[s].length > 0);
  let safetyBackup = null;
  if (autoBackup && hadData) safetyBackup = (await exportAll()).filename;
  await replaceAllRaw(next); // single transaction
  return { mode, safetyBackup, records: countRecords(next) };
}
