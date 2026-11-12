// Reads and writes the data behind Cambridge Practice (attempts, tests). Views call this, not repo.js directly.
import { list, query, get, put } from "./repo.js";
import { DEFAULT_BOOK_ORDER } from "./next-test.js";
import { BOOKS, testKey } from "./progress.js";

export function loadBookOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem("bookOrder"));
    if (Array.isArray(saved) && saved.length && saved.every((b) => BOOKS.includes(b))) return saved;
  } catch { /* storage unavailable or invalid: use the default */ }
  return DEFAULT_BOOK_ORDER;
}

export async function loadPracticeData() {
  const [attempts, tests] = await Promise.all([list("attempts"), list("tests")]);
  return { attempts, tests, bookOrder: loadBookOrder() };
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
export async function saveAttempt({ book, test, skill, task = null, rawScore = null, band, date, durationMin = null, note = "" }) {
  const sameTest = await query("attempts", "bookTest", [book, test]);
  const existing = sameTest.find((a) => a.skill === skill && (skill !== "W" || (a.task ?? 2) === task));
  const rec = { ...(existing ?? {}), book, test, skill, band, date, durationMin, note };
  if (skill === "W") rec.task = task;
  else delete rec.task;
  if (rawScore === null) delete rec.rawScore;
  else rec.rawScore = rawScore;
  return put("attempts", rec);
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
