// IndexedDB upgrade steps, kept apart from db.js so that they can be tested with a stand-in database.
//   before version 2: create the data stores of schema.js (idempotent, as it always was)
//   before version 3: create the local-only stores. A database that is already at version 2 gets ONLY this step:
//                     its data stores and their records are not touched at all.
//   before version 4: a database at version 2 or 3 gets the data stores it lacks (settings); stores that exist are not opened.
function createStore(db, name, def) {
  const store = db.createObjectStore(name, { keyPath: def.keyPath });
  for (const ix of def.indexes) store.createIndex(ix.name, ix.keyPath, { unique: ix.unique, multiEntry: ix.multiEntry });
}

export function upgradeDb(db, tx, oldVersion, { storeDefs, localStores }) {
  if (oldVersion < 2) {
    for (const [name, def] of Object.entries(storeDefs)) {
      const store = db.objectStoreNames.contains(name) ? tx.objectStore(name) : db.createObjectStore(name, { keyPath: def.keyPath });
      for (const ix of def.indexes) {
        if (!store.indexNames.contains(ix.name)) store.createIndex(ix.name, ix.keyPath, { unique: ix.unique, multiEntry: ix.multiEntry });
      }
    }
  } else if (oldVersion < 4) {
    for (const [name, def] of Object.entries(storeDefs)) {
      if (!db.objectStoreNames.contains(name)) createStore(db, name, def);
    }
  }
  if (oldVersion < 3) {
    for (const [name, def] of Object.entries(localStores)) {
      if (!db.objectStoreNames.contains(name)) createStore(db, name, def);
    }
  }
}
