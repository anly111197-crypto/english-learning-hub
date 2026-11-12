// Rules of the in-app practice screen (spec 5.9) that are not about the DOM. Pure functions: no IndexedDB, no files.
// Nothing here ever holds the text of an exam, only the learner's own answers.

// ---- Question layout (spec 5.9) ----
const RANGES = {
  L: [[1, 10], [11, 20], [21, 30], [31, 40]],
  R: [[1, 13], [14, 26], [27, 40]],
};
export const TOTAL_QUESTIONS = 40;

export const isSheetSkill = (skill) => skill === "L" || skill === "R";

// [{ part: 1, from: 1, to: 10, numbers: [1..10] }, ...]; Listening has 4 parts, Reading 3 passages.
export function partGroups(skill) {
  return (RANGES[skill] ?? []).map(([from, to], i) => ({
    part: i + 1, from, to, numbers: Array.from({ length: to - from + 1 }, (_, k) => from + k),
  }));
}

// Part (or passage) number that question n belongs to, or null.
export function partOfQuestion(skill, n) {
  const g = partGroups(skill).find((x) => n >= x.from && n <= x.to);
  return g ? g.part : null;
}

// ---- Clock ----
export const MINUTES = { L: 30, R: 60, W: { 1: 20, 2: 40 } };
export const MIN_LIMIT = 1;
export const MAX_LIMIT = 180;

export function defaultMinutes(skill, task = 2) {
  return skill === "W" ? (MINUTES.W[task] ?? MINUTES.W[2]) : (MINUTES[skill] ?? 60);
}

export const remainingSec = (limitMin, elapsedSec) => Math.max(0, Math.round(limitMin * 60 - elapsedSec));
export const isTimeUp = (limitMin, elapsedSec) => elapsedSec >= limitMin * 60;
export const clampLimit = (value, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, n)) : fallback;
};

export function formatClockSec(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// Minutes written on the attempt: whole minutes, at least 1.
export const durationMinutes = (elapsedSec) => Math.max(1, Math.ceil(elapsedSec / 60));

// ---- Scoring (the learner marks each answer by hand against their own book) ----
// marks: { "1": true, "2": false, ... }. A question that is not marked counts as not correct.
export const countCorrect = (marks) => Object.values(marks ?? {}).filter((v) => v === true).length;
export const countUnmarked = (marks, total = TOTAL_QUESTIONS) => {
  let marked = 0;
  for (let n = 1; n <= total; n++) if (typeof marks?.[n] === "boolean") marked++;
  return total - marked;
};
export const countBlank = (answers, total = TOTAL_QUESTIONS) => {
  let filled = 0;
  for (let n = 1; n <= total; n++) if (String(answers?.[n] ?? "").trim() !== "") filled++;
  return total - filled;
};

// ---- Draft (stored by the view in localStorage, one per test and skill) ----
export const DRAFT_VERSION = 1;
const KEY_PREFIX = "elh.run.";

// Writing keeps one draft per Task, so the key carries the task: "15-1-W-2".
export const draftKey = (book, test, skill, task = null) => `${KEY_PREFIX}${book}-${test}-${skill}${skill === "W" ? `-${task ?? 2}` : ""}`;

export const emptyDraft = (skill, task = 2) => ({
  v: DRAFT_VERSION, phase: "answer", answers: {}, marks: {}, elapsedSec: 0, limitMin: defaultMinutes(skill, task),
});

const isQuestionNumber = (k) => /^\d+$/.test(k) && Number(k) >= 1 && Number(k) <= TOTAL_QUESTIONS;

// Turns whatever was stored into a safe draft, or null when it is not one (old version, damaged JSON, wrong shape).
export function parseDraft(raw, skill, task = 2) {
  let data = raw;
  if (typeof raw === "string") {
    try { data = JSON.parse(raw); } catch { return null; }
  }
  if (!data || typeof data !== "object" || Array.isArray(data) || data.v !== DRAFT_VERSION) return null;
  const draft = emptyDraft(skill, task);
  if (data.phase === "grade" && isSheetSkill(skill)) draft.phase = "grade";
  for (const [k, v] of Object.entries(data.answers ?? {})) {
    if (isQuestionNumber(k) && typeof v === "string") draft.answers[k] = v.slice(0, 200);
  }
  for (const [k, v] of Object.entries(data.marks ?? {})) {
    if (isQuestionNumber(k) && typeof v === "boolean") draft.marks[k] = v;
  }
  if (Number.isFinite(data.elapsedSec) && data.elapsedSec >= 0) draft.elapsedSec = data.elapsedSec;
  draft.limitMin = clampLimit(data.limitMin, draft.limitMin);
  if (skill === "W") {
    // A copy of the Writing text kept next to the clock: it is written on every pause in typing, so a reload cannot
    // lose it even if the database write has not finished. The database copy (submissions) is the real one.
    draft.text = typeof data.text === "string" ? data.text.slice(0, MAX_TEXT) : "";
    draft.prompt = typeof data.prompt === "string" ? data.prompt.slice(0, MAX_TEXT) : "";
  }
  draft.savedAt = typeof data.savedAt === "string" ? data.savedAt : "";
  return draft;
}

const MAX_TEXT = 20000;

// Is there anything worth restoring? (An untouched draft is not stored at all.)
export const hasProgress = (draft) => Boolean(draft)
  && (draft.elapsedSec > 0 || Object.values(draft.answers).some((v) => v.trim() !== "") || Object.keys(draft.marks).length > 0
    || String(draft.text ?? "").trim() !== "" || String(draft.prompt ?? "").trim() !== "");

// Writing: which copy to continue from, the one beside the clock or the one in the database? The newer one.
export function pickWritingState(draft, submission) {
  const local = { text: draft?.text ?? "", prompt: draft?.prompt ?? "" };
  const stored = { text: submission?.text ?? "", prompt: submission?.prompt ?? "" };
  const hasLocal = local.text !== "" || local.prompt !== "";
  if (!hasLocal) return stored;
  if (!submission) return local;
  return Date.parse(draft.savedAt) > Date.parse(submission.updatedAt) ? local : stored;
}

// storage: anything with getItem / setItem / removeItem (localStorage). Every call is guarded: storage can be
// blocked or full, and the screen must still work without it.
export function loadDraft(storage, key, skill, task = 2) {
  try { return parseDraft(storage.getItem(key), skill, task); } catch { return null; }
}
export function saveDraft(storage, key, draft) {
  try {
    if (!hasProgress(draft)) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
    return true;
  } catch { return false; }
}
export function clearDraft(storage, key) {
  try { storage.removeItem(key); } catch { /* nothing to clear */ }
}

// ---- Remembered file names (names only, never the files) ----
const FILES_PREFIX = "elh.runFiles.";
export const filesKey = (book, test) => `${FILES_PREFIX}${book}-${test}`;

export function loadFileNames(storage, key) {
  try {
    const v = JSON.parse(storage.getItem(key));
    if (!v || typeof v !== "object") return null;
    const audio = Array.isArray(v.audio) ? v.audio.filter((x) => typeof x === "string").slice(0, 8) : [];
    const pdf = typeof v.pdf === "string" ? v.pdf : "";
    return pdf || audio.length ? { pdf, audio } : null;
  } catch { return null; }
}
export function saveFileNames(storage, key, { pdf = "", audio = [] }) {
  try { storage.setItem(key, JSON.stringify({ pdf, audio })); } catch { /* not important */ }
}

// ---- Files picked by the learner ----
const AUDIO_EXT = /\.(mp3|m4a|wav|ogg|aac|flac)$/i;
const PDF_EXT = /\.pdf$/i;
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export const isPdfFile = (f) => f.type === "application/pdf" || PDF_EXT.test(f.name ?? "");
export const isAudioFile = (f) => (f.type ?? "").startsWith("audio/") || AUDIO_EXT.test(f.name ?? "");

// "Track 2.mp3" before "Track 10.mp3". Returns a new array; the first PDF is the exam, every audio file is a track.
export function sortByName(files) {
  return [...files].sort((a, b) => collator.compare(a.name, b.name));
}
export function classifyFiles(files) {
  const list = Array.from(files ?? []);
  return {
    pdf: list.find(isPdfFile) ?? null,
    audio: sortByName(list.filter(isAudioFile)),
    ignored: list.filter((f) => !isPdfFile(f) && !isAudioFile(f)),
  };
}

// 4 files or fewer: "Part 1 · name" ...; one file is a single recording of everything.
export const trackLabel = (index, count, name) => (count === 1 ? name : `Part ${index + 1} · ${name}`);

// ---- Drive preview link ----
// The link saved in step 3 -> the embeddable preview URL, or null when it is not a Drive file link.
export function driveFileId(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:" || u.hostname !== "drive.google.com") return null;
  const m = /^\/file\/(?:u\/\d+\/)?d\/([\w-]{10,})/.exec(u.pathname);
  const id = m?.[1] ?? u.searchParams.get("id");
  return id && /^[\w-]{10,}$/.test(id) ? id : null;
}
export const drivePreviewUrl = (id) => `https://drive.google.com/file/d/${id}/preview`;

// ---- Writing ----
export const WRITING_MIN_WORDS = { 1: 150, 2: 250 };

export function countWords(text) {
  return (String(text ?? "").match(/\S+/g) ?? []).length;
}

// { words, min, short } where short = how many words are missing (0 when the minimum is reached).
export function wordStatus(text, task) {
  const words = countWords(text);
  const min = WRITING_MIN_WORDS[task] ?? WRITING_MIN_WORDS[2];
  return { words, min, short: Math.max(0, min - words) };
}

// The unfinished piece for this test and task: newest draft that has no doneAt. Deleted records are ignored.
export function findWritingDraft(submissions, { book, test, task }) {
  return (submissions ?? [])
    .filter((s) => s.kind === "writing" && !s.deleted && s.status === "draft" && !s.doneAt
      && s.source?.book === book && s.source?.test === test && Number(s.source?.task) === task)
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))[0] ?? null;
}
