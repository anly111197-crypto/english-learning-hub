// Reads and writes the data behind Cambridge Practice (attempts, tests). Views call this, not repo.js directly.
import { list, query, get, put } from "./repo.js";
import { DEFAULT_BOOK_ORDER } from "./next-test.js";
import { BOOKS, testKey } from "./progress.js";
import { countWords, findWritingDraft } from "./practice-run.js";

export function loadBookOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem("bookOrder"));
    if (Array.isArray(saved) && saved.length && saved.every((b) => BOOKS.includes(b))) return saved;
  } catch { /* storage unavailable or invalid: use the default */ }
  return DEFAULT_BOOK_ORDER;
}

export async function loadPracticeData() {
  const [attempts, tests, vocab, errors, occurrences, notes, notebooks] = await Promise.all([
    list("attempts"), list("tests"), list("vocab"), list("errors"), list("occurrences"), list("notes"), list("notebooks"),
  ]);
  return { attempts, tests, vocab, errors, occurrences, notes, notebooks, bookOrder: loadBookOrder() };
}

// Everything the Dashboard needs: the practice data plus the warm-up sessions.
export async function loadDashboardData() {
  const [data, sessions] = await Promise.all([loadPracticeData(), list("sessions")]);
  return { ...data, sessions };
}

// Only https:// links are accepted (and shown): imported backups could contain anything.
export function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

// One attempt per book/test/skill (and per Task for Writing). Saving again overwrites the old one.
// findAttempt returns the attempt that saving would overwrite, or null.
export async function findAttempt(book, test, skill, task = null) {
  const sameTest = await query("attempts", "bookTest", [book, test]);
  return sameTest.find((a) => a.skill === skill && (skill !== "W" || (a.task ?? 2) === task)) ?? null;
}

export async function saveAttempt({ book, test, skill, task = null, rawScore = null, band, date, durationMin = null, note = "", submissionId = null }) {
  const existing = await findAttempt(book, test, skill, task);
  const rec = { ...(existing ?? {}), book, test, skill, band, date, durationMin, note };
  if (submissionId) rec.submissionId = submissionId;
  if (skill === "W") rec.task = task;
  else delete rec.task;
  if (rawScore === null) delete rec.rawScore;
  else rec.rawScore = rawScore;
  return put("attempts", rec);
}

// ---- Writing pieces written on the practice screen (spec 5.9) ----
// The unfinished piece for this test and Task (status "draft", no doneAt), or null.
export async function loadWritingDraft(book, test, task) {
  return findWritingDraft(await query("submissions", "kind", "writing"), { book, test, task });
}

// Creates the piece on the first save and updates the same record afterwards. Returns the stored record.
export async function saveWritingDraft({ id = null, book, test, task, prompt = "", text = "", durationSec = 0 }) {
  const old = id ? await get("submissions", id) : null;
  const rec = {
    ...(old ?? {}),
    kind: "writing", source: { book, test, task }, taskType: old?.taskType ?? "",
    prompt, text, wordCount: countWords(text), durationSec: Math.round(durationSec), status: old?.status ?? "draft",
  };
  if (id) rec.id = id;
  return put("submissions", rec);
}

// "Xong": the text is final. The status stays "draft" until Claude analyzes it (step 8); doneAt tells them apart.
export async function finishWriting(fields) {
  const rec = await saveWritingDraft(fields);
  return put("submissions", { ...rec, doneAt: new Date().toISOString() });
}

const emptyTest = (book, test) => ({ key: testKey(book, test), book, test, pdfUrl: "", audioUrls: ["", "", "", ""], pinned: false, note: "" });

async function getTestRecord(book, test) {
  return (await get("tests", testKey(book, test))) ?? emptyTest(book, test);
}

export async function setLinks(book, test, { pdfUrl, audioUrls }) {
  const rec = await getTestRecord(book, test);
  return put("tests", { ...rec, pdfUrl, audioUrls });
}

// Pinning one test unpins every other (spec 6.2: "the pinned test").
export async function setPinned(book, test, pinned) {
  const key = testKey(book, test);
  if (pinned) {
    for (const other of await list("tests")) {
      if (other.pinned && other.key !== key) await put("tests", { ...other, pinned: false });
    }
  }
  const rec = await getTestRecord(book, test);
  return put("tests", { ...rec, pinned });
}
