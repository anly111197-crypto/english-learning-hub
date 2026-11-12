// Everything the Dashboard shows, computed from the tables each time the page opens (spec 6.8).
// Pure functions. Numbers come from the same helpers as the other screens, so they always agree.
import { BOOKS, TESTS, indexAttempts, totalDone, averageSummary, SKILL_NAMES } from "./progress.js";
import { nextTest, latestAttempt } from "./next-test.js";
import { isDue, isoDate } from "./leitner.js";
import { summarizeErrors } from "./errors.js";
import { pickErrorQueue } from "./warmup.js";
import { formatBand } from "./bands.js";

export const TARGET_BAND = 7.0;
export const ACTIVITY_LIMIT = 5;
export const BACKUP_WARN_DAYS = 3;
export const TOTAL_TESTS = BOOKS.length * TESTS.length;

const live = (list) => list.filter((r) => !r.deleted);
const pad = (n) => String(n).padStart(2, "0");

// ---- Dates ----
function daysBetween(fromIso, toIso) {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

export function viDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

// "Hôm nay" / "Hôm qua" / dd/mm/yyyy
export function dateLabel(iso, today) {
  const d = daysBetween(String(iso).slice(0, 10), today);
  return d === 0 ? "Hôm nay" : d === 1 ? "Hôm qua" : viDate(iso);
}

// ---- Recent activity ----
const testLabel = (s) => `Cam ${s.book} Test ${s.test}`;

function attemptItem(a) {
  const skill = a.skill === "W" && a.task ? `Writing Task ${a.task}` : SKILL_NAMES[a.skill] ?? a.skill;
  const detail = typeof a.rawScore === "number" ? `${a.rawScore}/40 · Band ${formatBand(a.band)}` : `Band ${formatBand(a.band)}`;
  return {
    id: `attempt:${a.id}`, kind: "attempt", date: a.date, ts: a.updatedAt ?? "",
    title: `Cam ${a.book} · Test ${a.test} · ${skill}`, detail,
    href: `#/practice/${a.book}/${a.test}`, linkLabel: "Xem test",
  };
}

function sessionItem(s) {
  const w = s.warmup ?? {};
  const parts = [];
  if (w.vocabTotal) parts.push(`nhớ ${w.vocabCorrect}/${w.vocabTotal} từ`);
  if (w.errorsTotal) parts.push(`sửa đúng ${w.errorsCorrect}/${w.errorsTotal} lỗi`);
  return {
    id: `session:${s.id}`, kind: "warmup", date: s.date, ts: s.updatedAt ?? "",
    title: "Khởi động", detail: parts.join(" · "), href: "#/warmup", linkLabel: "Khởi động",
  };
}

// Words and errors written down with quick capture, grouped by (day, test). Counts are the number of times
// something was written down (occurrence records), so writing a known word again counts again.
function captureItems(occurrences) {
  const groups = new Map();
  for (const o of live(occurrences)) {
    if (!o.date || o.sessionId || o.submissionId || (o.itemType !== "vocab" && o.itemType !== "error")) continue;
    const s = o.source;
    const key = `${o.date}|${s?.book && s?.test ? `${s.book}-${s.test}` : "none"}`;
    const g = groups.get(key) ?? { date: o.date, source: s?.book && s?.test ? s : null, words: 0, errors: 0, ts: "" };
    if (o.itemType === "vocab") g.words++;
    else g.errors++;
    if ((o.createdAt ?? "") > g.ts) g.ts = o.createdAt ?? "";
    groups.set(key, g);
  }
  return [...groups.entries()].map(([key, g]) => {
    const what = [g.words ? `${g.words} từ` : null, g.errors ? `${g.errors} lỗi` : null].filter(Boolean).join(", ");
    const href = g.source ? `#/practice/${g.source.book}/${g.source.test}` : g.words ? "#/vocab" : "#/errors";
    return {
      id: `capture:${key}`, kind: "capture", date: g.date, ts: g.ts,
      title: `${g.words + g.errors} lần ghi (${what})`, detail: g.source ? testLabel(g.source) : "Không gắn test",
      href, linkLabel: g.source ? "Xem test" : g.words ? "Xem từ vựng" : "Xem lỗi",
    };
  });
}

// The newest `limit` items from attempts, warm-up sessions and quick capture, newest first.
export function recentActivity({ attempts = [], sessions = [], occurrences = [] }, today, limit = ACTIVITY_LIMIT) {
  const gradedSessions = live(sessions).filter((s) => (s.warmup?.vocabTotal ?? 0) + (s.warmup?.errorsTotal ?? 0) > 0);
  return [...live(attempts).map(attemptItem), ...gradedSessions.map(sessionItem), ...captureItems(occurrences)]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.ts).localeCompare(String(a.ts)) || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((item) => ({ ...item, dateLabel: dateLabel(item.date, today) }));
}

// ---- The numbers ----
export function computeDashboard({ attempts = [], tests = [], vocab = [], errors = [], occurrences = [], sessions = [], bookOrder, today = isoDate() } = {}) {
  const liveAttempts = live(attempts);
  const liveVocab = live(vocab);
  const liveErrors = live(errors);
  const index = indexAttempts(liveAttempts);

  const next = nextTest({ attempts: liveAttempts, tests, bookOrder });
  const latest = latestAttempt(liveAttempts);

  const done = totalDone(index);
  const avg = averageSummary(index);
  const overall = avg.overall.value;

  const openErrors = liveErrors.filter((e) => e.status !== "fixed");
  const errorSummary = summarizeErrors(openErrors, occurrences, today);
  const top = errorSummary.top;

  const dueWords = liveVocab.filter((w) => isDue(w, today)).length;
  const warmedToday = live(sessions).some((s) => s.date === today && (s.warmup?.vocabTotal ?? 0) + (s.warmup?.errorsTotal ?? 0) > 0);

  const gap = overall === null ? null : Math.max(0, TARGET_BAND - overall);
  const typeQuery = top ? (top.slug === "" ? "unknown" : top.slug) : null;

  return {
    next,
    due: { words: dueWords, errors: pickErrorQueue(liveErrors).length },
    warmedToday,
    progress: {
      done, total: TOTAL_TESTS, pct: Math.round((done / TOTAL_TESTS) * 100),
      currentBook: latest?.book ?? null,
      href: "#/practice",
    },
    band: {
      overall, count: avg.overall.count, estimated: avg.overall.estimated, skills: avg.rounded,
      target: TARGET_BAND, gap, reached: overall !== null && overall >= TARGET_BAND,
      pct: overall === null ? 0 : Math.min(100, Math.round((overall / TARGET_BAND) * 100)),
      href: "#/practice?status=improve",
    },
    vocab: {
      total: liveVocab.length, due: dueWords, pending: liveVocab.filter((w) => !w.enriched).length,
      href: dueWords > 0 ? "#/vocab?due=1" : "#/vocab",
    },
    errors: {
      open: openErrors.length, fixed: liveErrors.length - openErrors.length, total: liveErrors.length,
      top: top ? { slug: top.slug, label: top.label, count: top.count } : null,
      href: typeQuery ? `#/errors?type=${typeQuery}&status=open` : "#/errors?status=open",
    },
    activity: recentActivity({ attempts, sessions, occurrences }, today),
    isEmpty: liveAttempts.length === 0 && liveVocab.length === 0 && liveErrors.length === 0 && live(sessions).length === 0,
  };
}

// ---- Backup reminder ----
// lastBackupAt: ISO time of the last export (or null). hasData: any record exists. hasNewData: a record was
// updated after that export. Returns { text, level: "none" | "ok" | "warn" }.
export function backupStatus({ lastBackupAt = null, hasData = false, hasNewData = false, today = isoDate() } = {}) {
  if (!lastBackupAt) return hasData ? { text: "Sao lưu lần cuối: chưa sao lưu lần nào", level: "warn" } : { text: "", level: "none" };
  const d = new Date(lastBackupAt);
  if (Number.isNaN(d.getTime())) return { text: "", level: "none" };
  const last = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const days = Math.max(0, daysBetween(last, today));
  const when = days === 0 ? "hôm nay" : `${days} ngày trước`;
  return { text: `Sao lưu lần cuối: ${when}`, level: days > BACKUP_WARN_DAYS && hasNewData ? "warn" : "ok" };
}
