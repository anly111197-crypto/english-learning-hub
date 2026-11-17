// Stores that live ONLY on this device. They are deliberately NOT in schema.js STORE_DEFS, so they never reach
// exportRaw / replaceAllRaw, the backup JSON or elh-data.json on Drive (spec 7.2: backups never contain recordings).
// DB_VERSION is the IndexedDB version; SCHEMA_VERSION in schema.js is the backup format is 3 since the settings store.
export const DB_VERSION = 4; // 4: the settings data store

export const LOCAL_STORES = {
  // Speaking recordings (step 8c-1): { id, submissionId, part, createdAt, durationSec, mimeType, size, audio: ArrayBuffer }
  recordings: {
    keyPath: "id",
    indexes: [
      { name: "submissionId", keyPath: "submissionId", unique: false, multiEntry: false },
      { name: "createdAt", keyPath: "createdAt", unique: false, multiEntry: false },
    ],
  },
};
