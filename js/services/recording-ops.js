// Speaking recordings on this device (step 8c-1). They live in their own IndexedDB store (local-schema.js), outside
// repo.js: nothing here is part of the backup or of the Drive sync file. The audio is kept as an ArrayBuffer (older
// Safari versions are unreliable with a Blob in IndexedDB) and turned back into a Blob to play it.
import { getDB } from "./db.js";
import { pickRecordingsToDelete } from "./recorder.js";
import { MAX_RECORDINGS } from "../config.js";

// Delete everything beyond the newest `max` (whole device). Only keys are read, not the audio. Returns how many went.
export async function pruneRecordings(max = MAX_RECORDINGS) {
  const db = await getDB();
  const tx = db.transaction("recordings", "readwrite");
  const all = [];
  let cursor = await tx.store.index("createdAt").openKeyCursor();
  while (cursor) {
    all.push({ createdAt: cursor.key, id: cursor.primaryKey });
    cursor = await cursor.continue();
  }
  const drop = pickRecordingsToDelete(all, max);
  for (const id of drop) await tx.store.delete(id);
  await tx.done;
  return drop.length;
}

// blob: what MediaRecorder produced. Returns the stored record (without the audio data).
export async function saveRecording({ submissionId, part, durationSec, mimeType, blob }) {
  const audio = await blob.arrayBuffer();
  const rec = {
    id: crypto.randomUUID(), submissionId, part: Number(part) || 1, createdAt: new Date().toISOString(),
    durationSec: Math.max(0, Math.round(durationSec)), mimeType: mimeType || blob.type || "audio/webm", size: audio.byteLength, audio,
  };
  const db = await getDB();
  await db.put("recordings", rec);
  await pruneRecordings();
  const { audio: _audio, ...meta } = rec;
  return meta;
}

// The recordings of one piece, newest first, with their audio.
export async function listRecordings(submissionId) {
  if (!submissionId) return [];
  const db = await getDB();
  const rows = await db.getAllFromIndex("recordings", "submissionId", submissionId);
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)));
}

export async function deleteRecording(id) {
  const db = await getDB();
  await db.delete("recordings", id);
}

export async function countRecordings() {
  return (await getDB()).count("recordings");
}

export const recordingBlob = (rec) => new Blob([rec.audio], { type: rec.mimeType });
