// Generic CRUD over IndexedDB. Views and other services go through here, never through idb directly.
// Every record gets id (or key for `tests`), createdAt, updatedAt, deleted. Delete = tombstone (deleted: true).
import { getDB } from "./db.js";
import { STORE_NAMES, KEY_FIELD, NATURAL_KEY, withDerived } from "./schema.js";

export class RepoError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "RepoError";
    this.cause = cause;
  }
}

const nowIso = () => new Date().toISOString();

function assertStore(store) {
  if (!STORE_NAMES.includes(store)) throw new RepoError(`Không có kho dữ liệu "${store}".`);
}

function conflictMessage(store, rec) {
  if (store === "vocab") return `Từ "${rec.lemma ?? rec.word}" (${rec.pos || "chưa rõ loại từ"}) đã có trong kho. Không ghi đè bản ghi khác; hãy gộp hai bản ghi trước.`;
  if (store === "errors") return `Lỗi có signature "${rec.signature}" đã có trong sổ. Không ghi đè bản ghi khác.`;
  return `Nhóm "${rec.group}" đã tồn tại. Không ghi đè bản ghi khác.`;
}

export async function put(store, obj) {
  assertStore(store);
  const db = await getDB();
  const tx = db.transaction(store, "readwrite");
  tx.done.catch(() => {}); // failures are reported through the awaited calls below
  const os = tx.objectStore(store);
  try {
    const rec = structuredClone(obj);
    const keyField = KEY_FIELD[store];
    const stamp = nowIso();

    if (store === "tests") {
      if (!rec.key) throw new RepoError('Test cần có key, ví dụ "15-3".');
    } else if (!rec.id) {
      rec.id = crypto.randomUUID();
    }

    const existing = await os.get(rec[keyField]);
    rec.createdAt = existing?.createdAt ?? rec.createdAt ?? stamp;
    rec.updatedAt = stamp;
    rec.deleted = rec.deleted ?? false;

    try {
      withDerived(store, rec); // recomputes lemmaPos etc., so a changed pos moves the unique key
    } catch (e) {
      throw new RepoError(e.message, e);
    }

    const nk = NATURAL_KEY[store];
    if (nk) {
      const clash = await os.index(nk.field).get(rec[nk.field]);
      if (clash && clash[keyField] !== rec[keyField]) {
        if (clash.deleted && !existing) {
          // Re-adding something that was deleted: reuse the tombstone's identity.
          rec.id = clash.id;
          rec.createdAt = clash.createdAt ?? rec.createdAt;
        } else {
          throw new RepoError(conflictMessage(store, rec));
        }
      }
    }

    await os.put(rec);
    await tx.done;
    return rec;
  } catch (e) {
    try { tx.abort(); } catch { /* already finished */ }
    if (e instanceof RepoError) throw e;
    if (e?.name === "ConstraintError") throw new RepoError("Bản ghi bị trùng khoá duy nhất với một bản ghi khác.", e);
    throw e;
  }
}

export async function get(store, key, { includeDeleted = false } = {}) {
  assertStore(store);
  const rec = await (await getDB()).get(store, key);
  return rec && (includeDeleted || !rec.deleted) ? rec : undefined;
}

export async function list(store, { includeDeleted = false } = {}) {
  assertStore(store);
  const all = await (await getDB()).getAll(store);
  return includeDeleted ? all : all.filter((r) => !r.deleted);
}

// `value` can be a key, an array key (compound index) or an IDBKeyRange.
export async function query(store, indexName, value, { includeDeleted = false } = {}) {
  assertStore(store);
  const all = await (await getDB()).getAllFromIndex(store, indexName, value);
  return includeDeleted ? all : all.filter((r) => !r.deleted);
}

export async function softDelete(store, key) {
  assertStore(store);
  const db = await getDB();
  const tx = db.transaction(store, "readwrite");
  tx.done.catch(() => {});
  const rec = await tx.store.get(key);
  if (!rec || rec.deleted) {
    tx.abort();
    return undefined;
  }
  rec.deleted = true;
  rec.updatedAt = nowIso();
  await tx.store.put(rec);
  await tx.done;
  return rec;
}

// ---- Whole-database operations (backup / dev tools) ----

// Every record of every store, tombstones included, exactly as stored.
export async function exportRaw() {
  const db = await getDB();
  const tx = db.transaction(STORE_NAMES, "readonly");
  const out = {};
  await Promise.all(STORE_NAMES.map(async (s) => { out[s] = await tx.objectStore(s).getAll(); }));
  await tx.done;
  return out;
}

// Replace the whole database in ONE transaction: if anything fails, nothing changes.
export async function replaceAllRaw(data) {
  const db = await getDB();
  const tx = db.transaction(STORE_NAMES, "readwrite");
  tx.done.catch(() => {});
  try {
    for (const s of STORE_NAMES) {
      const os = tx.objectStore(s);
      await os.clear();
      for (const rec of data[s] ?? []) await os.put(withDerived(s, structuredClone(rec)));
    }
    await tx.done;
  } catch (e) {
    try { tx.abort(); } catch { /* already finished */ }
    throw new RepoError(`Không ghi được dữ liệu, kho dữ liệu giữ nguyên. (${e.message})`, e);
  }
}

export const clearAll = () => replaceAllRaw({});
