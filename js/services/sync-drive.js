// Google Drive sync (spec 7.2): a small Drive REST client plus the pull -> merge -> push cycle.
// Pure with respect to the browser: `fetch`, the token source and local storage access are injected, so
// `node --test` can run it against a fake Drive. Tokens are only ever used as an Authorization header
// and never end up in the uploaded file.
import { APP_ID, SCHEMA_VERSION, STORE_NAMES, KEY_FIELD } from "./schema.js";
import { mergeData, validateBackup } from "./merge.js";
import { SYNC_FILE_NAME } from "../config.js";

const API = "https://www.googleapis.com";

// code: "auth" (sign in again) | "network" | "remote-invalid" (Drive file unreadable, left untouched)
//       | "busy" (local data kept changing) | "drive" (other Drive error)
export class SyncError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "SyncError";
    this.code = code;
    this.cause = cause;
  }
}

// ---- Snapshots: which record (by key) is at which updatedAt / deleted state ----

export function snapshot(data) {
  const out = new Map();
  for (const store of STORE_NAMES) {
    for (const rec of data[store] ?? []) {
      out.set(`${store}/${rec[KEY_FIELD[store]]}`, `${rec.updatedAt}|${rec.deleted ? 1 : 0}`);
    }
  }
  return out;
}

export function sameSnapshot(a, b) {
  const x = snapshot(a);
  const y = snapshot(b);
  if (x.size !== y.size) return false;
  for (const [k, v] of x) if (y.get(k) !== v) return false;
  return true;
}

export function buildPayload(data, nowMs = Date.now()) {
  const out = {};
  for (const store of STORE_NAMES) out[store] = data[store] ?? [];
  return { app: APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt: new Date(nowMs).toISOString(), data: out };
}

// ---- Drive REST client (appDataFolder) ----

export function createDriveClient({ fetch: fetchFn, getToken }) {
  async function call(url, init = {}) {
    const token = await getToken();
    if (!token) throw new SyncError("auth", "Cần đăng nhập lại Google.");
    let res;
    try {
      res = await fetchFn(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    } catch (e) {
      throw new SyncError("network", "Không kết nối được Google Drive.", e);
    }
    if (res.status === 401) throw new SyncError("auth", "Cần đăng nhập lại Google.");
    if (res.status === 404) return null;
    if (!res.ok) throw new SyncError("drive", `Google Drive báo lỗi ${res.status}.`);
    return res;
  }
  async function bodyText(res) {
    try {
      return await res.text();
    } catch (e) {
      throw new SyncError("network", "Mất kết nối khi tải dữ liệu từ Google Drive.", e);
    }
  }

  return {
    // { id, modifiedTime } of the oldest file with the sync name (two devices creating it at once converge on the
    // same one), or null. One small request: this is also what the 60-second poll uses to see whether anything changed.
    async fileMeta() {
      const q = encodeURIComponent(`name = '${SYNC_FILE_NAME}' and trashed = false`);
      const fields = encodeURIComponent("files(id,createdTime,modifiedTime)");
      const res = await call(`${API}/drive/v3/files?spaces=appDataFolder&q=${q}&orderBy=createdTime&pageSize=10&fields=${fields}`);
      if (!res) return null;
      const json = JSON.parse(await bodyText(res));
      const f = json.files?.[0];
      return f ? { id: f.id, modifiedTime: f.modifiedTime ?? null } : null;
    },
    // Text of the file, or null when it no longer exists.
    async readFile(id) {
      const res = await call(`${API}/drive/v3/files/${encodeURIComponent(id)}?alt=media`);
      return res ? bodyText(res) : null;
    },
    async createFile(payload) {
      const boundary = `elh${Math.random().toString(36).slice(2)}`;
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify({ name: SYNC_FILE_NAME, parents: ["appDataFolder"] })}\r\n` +
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(payload)}\r\n--${boundary}--`;
      const res = await call(`${API}/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime`, {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      });
      if (!res) throw new SyncError("drive", "Google Drive không tạo được tệp đồng bộ.");
      const meta = JSON.parse(await bodyText(res));
      return { id: meta.id, modifiedTime: meta.modifiedTime ?? null };
    },
    // Returns { id, modifiedTime }, or null when the file vanished meanwhile.
    async updateFile(id, payload) {
      const res = await call(`${API}/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media&fields=id,modifiedTime`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify(payload),
      });
      if (!res) return null;
      const meta = JSON.parse(await bodyText(res));
      return { id: meta.id, modifiedTime: meta.modifiedTime ?? null };
    },
  };
}

// ---- One sync cycle ----

// deps: client, readLocal() -> data, writeLocal(merged, baseLocal) -> boolean (false = local data changed since
// `baseLocal` was read, nothing written), now() -> ms.
// Never writes anything locally unless the Drive file was read and validated; never overwrites an unreadable
// Drive file. Result: { created, changedLocal, pushed, modifiedTime } (modifiedTime of the Drive file as it is after
// this cycle: the poll compares against it).
export async function syncOnce({ client, readLocal, writeLocal, now = Date.now }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const local = await readLocal();
    const meta = await client.fileMeta();
    const fileId = meta?.id ?? null;
    const text = fileId ? await client.readFile(fileId) : null;

    if (text === null) { // no file (first sync ever, or it was deleted): create it from the local data
      const made = await client.createFile(buildPayload(local, now()));
      return { created: true, changedLocal: false, pushed: true, modifiedTime: made?.modifiedTime ?? null };
    }

    let remote;
    try {
      remote = validateBackup(JSON.parse(text));
    } catch (e) {
      throw new SyncError("remote-invalid", `Tệp trên Google Drive không đọc được, dữ liệu trên máy giữ nguyên. (${e.message})`, e);
    }

    const merged = mergeData(local, remote, { now: now() });
    let changedLocal = false;
    if (!sameSnapshot(merged, local)) {
      if (!(await writeLocal(merged, local))) continue; // the learner saved something meanwhile: redo from the top
      changedLocal = true;
    }
    let pushed = false;
    let modifiedTime = meta.modifiedTime;
    if (!sameSnapshot(merged, remote)) {
      const payload = buildPayload(merged, now());
      const after = (await client.updateFile(fileId, payload)) ?? (await client.createFile(payload)); // file vanished meanwhile
      modifiedTime = after?.modifiedTime ?? null;
      pushed = true;
    }
    return { created: false, changedLocal, pushed, modifiedTime };
  }
  throw new SyncError("busy", "Dữ liệu trên máy đang thay đổi liên tục, sẽ thử đồng bộ lại sau.");
}

// ---- The 60-second poll ----

// One small request: has the Drive file changed since the last cycle? `lastModified` is the modifiedTime kept from
// that cycle (null = unknown, e.g. nothing synced yet in this tab). Returns { changed, modifiedTime }.
// A missing file counts as changed (the full cycle recreates it). Unchanged means: no download, no merge.
export async function checkRemoteChanged({ client, lastModified }) {
  const meta = await client.fileMeta();
  if (!meta) return { changed: true, modifiedTime: null };
  const changed = !lastModified || !meta.modifiedTime || meta.modifiedTime !== lastModified;
  return { changed, modifiedTime: meta.modifiedTime };
}