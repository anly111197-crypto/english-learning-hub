import { openDB } from "../vendor/idb.js";
import { DB_NAME, SCHEMA_VERSION, STORE_DEFS } from "./schema.js";

let dbPromise = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, SCHEMA_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) {
        // Idempotent: create what is missing. Add `if (oldVersion < N)` blocks for future migrations.
        for (const [name, def] of Object.entries(STORE_DEFS)) {
          const store = db.objectStoreNames.contains(name)
            ? tx.objectStore(name)
            : db.createObjectStore(name, { keyPath: def.keyPath });
          for (const ix of def.indexes) {
            if (!store.indexNames.contains(ix.name)) {
              store.createIndex(ix.name, ix.keyPath, { unique: ix.unique, multiEntry: ix.multiEntry });
            }
          }
        }
      },
      terminated() { dbPromise = null; },
    });
  }
  return dbPromise;
}
