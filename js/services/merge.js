// Pure logic for backup validation and merging (spec 7.2). No IndexedDB, no DOM: runs under `node --test`.
import { APP_ID, SCHEMA_VERSION, STORE_NAMES, KEY_FIELD, NATURAL_KEY, withDerived } from "./schema.js";

export const TOMBSTONE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export class BackupError extends Error {
  constructor(message) {
    super(message);
    this.name = "BackupError";
  }
}

const ts = (s) => {
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
};
const byUpdated = (a, b) => ts(a.updatedAt) - ts(b.updatedAt) || String(a.id).localeCompare(String(b.id));
const byCreated = (a, b) => ts(a.createdAt) - ts(b.createdAt) || String(a.id).localeCompare(String(b.id));

// ---- Validation ----

// Check a parsed backup file and return its data with every store present and derived fields filled.
export function validateBackup(json) {
  if (!json || typeof json !== "object" || json.app !== APP_ID) {
    throw new BackupError("Đây không phải tệp sao lưu của English Learning Hub.");
  }
  if (!Number.isInteger(json.schemaVersion) || json.schemaVersion < 1) {
    throw new BackupError("Tệp sao lưu thiếu schemaVersion hợp lệ.");
  }
  if (json.schemaVersion > SCHEMA_VERSION) {
    throw new BackupError(`Tệp sao lưu có schemaVersion ${json.schemaVersion}, mới hơn app này (${SCHEMA_VERSION}). Hãy cập nhật app trước.`);
  }
  if (!json.data || typeof json.data !== "object") throw new BackupError("Tệp sao lưu thiếu phần dữ liệu.");

  const out = {};
  for (const store of STORE_NAMES) {
    const arr = json.data[store] ?? [];
    if (!Array.isArray(arr)) throw new BackupError(`Mục "${store}" trong tệp sao lưu không hợp lệ.`);
    const keyField = KEY_FIELD[store];
    const seen = new Set();
    out[store] = arr.map((raw, i) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new BackupError(`Bản ghi ${i + 1} của "${store}" không hợp lệ.`);
      }
      const key = raw[keyField];
      if (typeof key !== "string" || !key) throw new BackupError(`Bản ghi ${i + 1} của "${store}" thiếu ${keyField}.`);
      if (seen.has(key)) throw new BackupError(`Tệp sao lưu có hai bản ghi "${store}" trùng ${keyField} "${key}".`);
      seen.add(key);
      const rec = structuredClone(raw);
      try {
        return withDerived(store, rec);
      } catch (e) {
        throw new BackupError(`Bản ghi ${i + 1} của "${store}": ${e.message}`);
      }
    });
  }
  return out;
}

// Records sharing a unique natural key (vocab lemmaPos, errors signature, notebooks group).
// Tombstones count too, because the IndexedDB unique index covers them.
export function findUniqueConflicts(data) {
  const conflicts = [];
  for (const [store, { field }] of Object.entries(NATURAL_KEY)) {
    const groups = new Map();
    for (const rec of data[store] ?? []) {
      const k = rec[field];
      groups.set(k, [...(groups.get(k) ?? []), rec]);
    }
    for (const [value, recs] of groups) {
      if (recs.length > 1) conflicts.push({ store, field, value, count: recs.length, sample: recs[0] });
    }
  }
  return conflicts;
}

function conflictMessage({ store, value, count, sample }) {
  const tail = " Không có dữ liệu nào bị thay đổi.";
  if (store === "vocab") return `Tệp sao lưu có ${count} từ vựng trùng "${sample.lemma ?? sample.word}" (${sample.pos || "chưa rõ loại từ"}).${tail}`;
  if (store === "errors") return `Tệp sao lưu có ${count} lỗi sai trùng signature "${value}".${tail}`;
  return `Tệp sao lưu có ${count} notebook trùng nhóm "${value}".${tail}`;
}

// Decide what the database should contain after an import. Throws BackupError before anything is written.
export function planImport(local, json, mode, options) {
  if (mode !== "replace" && mode !== "merge") throw new BackupError('Chế độ khôi phục phải là "replace" hoặc "merge".');
  const incoming = validateBackup(json);
  if (mode === "replace") {
    const [first] = findUniqueConflicts(incoming);
    if (first) throw new BackupError(conflictMessage(first));
    return incoming;
  }
  return mergeData(local, incoming, options);
}

// ---- Merge ----

const ctxKey = (c) => `${c?.sentence ?? ""}|${JSON.stringify(c?.source ?? null)}`;

function unionContexts(recs) {
  const seen = new Set();
  const out = [];
  for (const r of recs) {
    for (const c of r.contexts ?? []) {
      const k = ctxKey(c);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(c);
      }
    }
  }
  return out;
}

// Collapse records that share a natural key into one; records the id remaps in `idMap`.
function collapseNatural(store, records, idMap) {
  const { field } = NATURAL_KEY[store];
  const groups = new Map();
  for (const rec of records) {
    const k = rec[field];
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(rec);
  }
  const kept = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      kept.push(group[0]);
      continue;
    }
    const live = group.filter((r) => !r.deleted);
    let result;
    if (live.length === 0) {
      result = [...group].sort(byUpdated).at(-1); // only tombstones: keep the newest
    } else {
      const newest = [...live].sort(byUpdated).at(-1);
      const oldest = [...live].sort(byCreated)[0];
      result = { ...newest, id: oldest.id, createdAt: oldest.createdAt, updatedAt: newest.updatedAt };
      if (store === "vocab") result.contexts = unionContexts([...live].sort(byCreated));
      if (store === "errors") {
        result.occurrences = live.reduce((sum, r) => sum + (Number(r.occurrences) || 0), 0);
        const firsts = live.map((r) => r.firstSeen).filter(Boolean).sort((a, b) => ts(a) - ts(b));
        const lasts = live.map((r) => r.lastSeen).filter(Boolean).sort((a, b) => ts(a) - ts(b));
        if (firsts.length) result.firstSeen = firsts[0];
        if (lasts.length) result.lastSeen = lasts.at(-1);
      }
    }
    for (const r of group) {
      if (r.id !== result.id) {
        if (!idMap.has(store)) idMap.set(store, new Map());
        idMap.get(store).set(r.id, result.id);
      }
    }
    kept.push(result);
  }
  return kept;
}

// mergeData(local, incoming) -> new data object; inputs are not modified.
// By id (by `key` for tests): newer updatedAt wins, ties keep local. Tombstones follow the same rule.
// Same lemmaPos / signature / group under different ids are merged into one record.
export function mergeData(local, incoming, { now = Date.now() } = {}) {
  const result = {};
  const idMap = new Map(); // store -> Map(removedId -> keptId)

  for (const store of STORE_NAMES) {
    const keyField = KEY_FIELD[store];
    const byKey = new Map();
    for (const rec of local[store] ?? []) byKey.set(rec[keyField], structuredClone(rec));
    for (const rec of incoming[store] ?? []) {
      const cur = byKey.get(rec[keyField]);
      if (!cur || ts(rec.updatedAt) > ts(cur.updatedAt)) byKey.set(rec[keyField], structuredClone(rec));
    }
    let records = [...byKey.values()].map((r) => withDerived(store, r));
    if (NATURAL_KEY[store]) records = collapseNatural(store, records, idMap);
    result[store] = records.filter((r) => !(r.deleted && now - ts(r.updatedAt) > TOMBSTONE_MAX_AGE_MS));
  }

  // Point references at the records that were kept.
  const remap = (store, id) => idMap.get(store)?.get(id) ?? id;
  const linkStore = { vocab: "vocab", error: "errors" };
  for (const rec of result.occurrences) {
    const target = linkStore[rec.itemType];
    if (target) rec.itemId = remap(target, rec.itemId);
  }
  for (const rec of result.exercises) {
    if (Array.isArray(rec.errorIds)) rec.errorIds = rec.errorIds.map((id) => remap("errors", id));
  }
  for (const rec of result.notes) {
    if (Array.isArray(rec.links)) {
      for (const l of rec.links) if (linkStore[l.type]) l.id = remap(linkStore[l.type], l.id);
      withDerived("notes", rec);
    }
  }
  return result;
}
