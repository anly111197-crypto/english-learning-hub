import { openDB } from "../vendor/idb.js";
import { DB_NAME, STORE_DEFS } from "./schema.js";
import { DB_VERSION, LOCAL_STORES } from "./local-schema.js";
import { upgradeDb } from "./db-upgrade.js";

let dbPromise = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) {
        upgradeDb(db, tx, oldVersion, { storeDefs: STORE_DEFS, localStores: LOCAL_STORES });
      },
      // Another tab of an older version holds the database open while this one upgrades it: let go, otherwise the
      // upgrade waits forever. (That older tab must be reloaded to work again.)
      blocking() {
        const closing = dbPromise;
        dbPromise = null;
        closing?.then((db) => db.close());
      },
      terminated() { dbPromise = null; },
    });
  }
  return dbPromise;
}
