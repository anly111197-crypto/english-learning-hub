// Study schedule for Dashboard (spec 5.1). Pure functions: the plan is COMPUTED from the settings and the attempts every
// time it is shown, never stored day by day (so two devices cannot disagree about it). A missed session therefore
// needs no special handling: what was not done is simply still pending and moves to the next study day.
import { BOOKS, TESTS, SKILL_NAMES, indexAttempts } from "./progress.js";
import { addDays } from "./leitner.js";

export const SCHEDULE_KEY = "schedule";
export const WARMUP_MINUTES = 15;
export const MIN_SESSION_MINUTES = 30;
export const MAX_SESSION_MINUTES = 600;
export const SKILL_ORDER = ["L", "R", "W", "S"];
export const SKILL_MINUTES = { L: 40, R: 60, W: 60, S: 15 };
export const MAX_S_PER_SESSION = 3;
export const TOTAL_ITEMS = BOOKS.length * TESTS.length * SKILL_ORDER.length; // 160
export const WEEKDAY_LABELS = { 1: "T2", 2: "T3", 3: "T4", 4: "T5", 5: "T6", 6: "T7", 7: "CN" };

export const DEFAULT_SETTINGS = Object.freeze({
  examDate: "", days: [1, 2, 3, 4, 5], minutes: 60, mode: "skill", order: "new",
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (s) => {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};

// ISO weekday of a "YYYY-MM-DD" date: Monday 1 ... Sunday 7.
export function isoWeekday(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getDay() || 7;
}

export const mondayOf = (iso) => addDays(iso, 1 - isoWeekday(iso));

// ---- Settings ----
// A stored record (or nothing) -> clean settings. Bad or missing fields fall back to the default.
export function normalizeSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const days = Array.isArray(r.days) ? [...new Set(r.days.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))].sort((a, b) => a - b) : [];
  const minutes = Number.isInteger(r.minutes) && r.minutes >= 1 && r.minutes <= MAX_SESSION_MINUTES ? r.minutes : DEFAULT_SETTINGS.minutes;
  return {
    examDate: isIsoDate(r.examDate) ? r.examDate : "",
    days: days.length ? days : [...DEFAULT_SETTINGS.days],
    minutes,
    mode: r.mode === "test" ? "test" : "skill",
    order: r.order === "old" ? "old" : "new",
  };
}

// What the dialog sends -> { ok, errors: [{field, message}], settings }. Nothing is saved when it is not ok.
export function validateSettings(input, today) {
  const errors = [];
  const i = input ?? {};
  const days = Array.isArray(i.days) ? [...new Set(i.days.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))].sort((a, b) => a - b) : [];
  if (days.length === 0) errors.push({ field: "days", message: "Chọn ít nhất một ngày học trong tuần." });

  const minutesRaw = typeof i.minutes === "string" ? i.minutes.trim() : i.minutes;
  const minutes = minutesRaw === "" || minutesRaw === null || minutesRaw === undefined ? NaN : Number(minutesRaw);
  if (!Number.isInteger(minutes)) errors.push({ field: "minutes", message: "Số phút mỗi buổi phải là số nguyên." });
  else if (minutes < MIN_SESSION_MINUTES) errors.push({ field: "minutes", message: `Mỗi buổi tối thiểu ${MIN_SESSION_MINUTES} phút (đã gồm ${WARMUP_MINUTES} phút khởi động).` });
  else if (minutes > MAX_SESSION_MINUTES) errors.push({ field: "minutes", message: `Mỗi buổi tối đa ${MAX_SESSION_MINUTES} phút.` });

  const examDate = typeof i.examDate === "string" ? i.examDate.trim() : "";
  if (examDate !== "") {
    if (!isIsoDate(examDate)) errors.push({ field: "examDate", message: "Ngày thi không hợp lệ." });
    else if (examDate < today) errors.push({ field: "examDate", message: "Ngày thi đã ở trong quá khứ. Chọn ngày từ hôm nay trở đi, hoặc để trống." });
  }
  const mode = i.mode === "test" ? "test" : "skill";
  const order = i.order === "old" ? "old" : "new";
  return { ok: errors.length === 0, errors, settings: { examDate, days, minutes: Number.isInteger(minutes) ? minutes : DEFAULT_SETTINGS.minutes, mode, order } };
}

// ---- Items: one (book, test, skill) per skill of every test = 160 ----
const attemptDay = (a) => String(a.date || a.createdAt || "").slice(0, 10);
export const itemKey = (it) => `${it.book}-${it.test}-${it.skill}`;
export const itemLabel = (it) => `Cam ${it.book} · Test ${it.test} · ${SKILL_NAMES[it.skill]}`;
export const itemShort = (it) => `Cam ${it.book} T${it.test} ${it.skill}`;

// Writing counts as done once Task 1 or Task 2 has a score (it is one item per test).
export function isItemDone(index, it) {
  const e = index.get(`${it.book}-${it.test}`);
  if (!e) return false;
  return it.skill === "W" ? Boolean(e.W1 || e.W2) : Boolean(e[it.skill]);
}

export function allItems(order = "new") {
  const books = order === "old" ? [...BOOKS] : [...BOOKS].reverse();
  const out = [];
  for (const book of books) for (const test of TESTS) for (const skill of SKILL_ORDER) out.push({ book, test, skill });
  return out;
}

const pendingItems = (index, order) => allItems(order).filter((it) => !isItemDone(index, it));
const withMinutes = (it) => ({ ...it, minutes: SKILL_MINUTES[it.skill] });

// ---- Packing the pending items into sessions ----
// skill mode: one skill per session, rotating L -> R -> W -> S (Speaking items are short: up to 3 fit in a session).
// test mode : one test per session with all of its missing skills.
function sInSession(settings) {
  return Math.min(MAX_S_PER_SESSION, Math.max(1, Math.floor((settings.minutes - WARMUP_MINUTES) / SKILL_MINUTES.S)));
}

function packSkillMode(pending, settings, startSkill) {
  const queues = Object.fromEntries(SKILL_ORDER.map((k) => [k, pending.filter((it) => it.skill === k)]));
  const groups = [];
  let cur = Math.max(0, SKILL_ORDER.indexOf(startSkill));
  while (SKILL_ORDER.some((k) => queues[k].length)) {
    let k = SKILL_ORDER[cur % 4];
    for (let n = 0; n < 4 && queues[k].length === 0; n++) { cur++; k = SKILL_ORDER[cur % 4]; }
    const take = k === "S" ? sInSession(settings) : 1;
    groups.push(queues[k].splice(0, take).map(withMinutes));
    cur++;
  }
  return groups;
}

function packTestMode(pending) {
  const groups = [];
  for (const it of pending) {
    const last = groups[groups.length - 1];
    if (last && last[0].book === it.book && last[0].test === it.test) last.push(withMinutes(it));
    else groups.push([withMinutes(it)]);
  }
  return groups;
}

const pack = (pending, settings, startSkill) => (settings.mode === "test" ? packTestMode(pending) : packSkillMode(pending, settings, startSkill));

// A session: Khởi động 15' first, then the items. `note` tells when the items do not fit in the minutes.
function describeGroup(items, settings) {
  const itemMinutes = items.reduce((s, it) => s + it.minutes, 0);
  const room = settings.minutes - WARMUP_MINUTES;
  let note = "";
  if (items.length && itemMinutes > room) note = settings.mode === "test" ? "chia nhiều lần" : "có thể chia 2 lần";
  return { items, warmupMinutes: WARMUP_MINUTES, itemMinutes, totalMinutes: WARMUP_MINUTES + itemMinutes, note };
}

// The skill after the one of the latest attempt made BEFORE today (rotation start), or "L".
function rotationStart(attempts, today) {
  const past = attempts.filter((a) => !a.deleted && attemptDay(a) && attemptDay(a) < today && SKILL_ORDER.includes(a.skill));
  if (!past.length) return "L";
  const latest = [...past].sort((a, b) => attemptDay(b).localeCompare(attemptDay(a)) || String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  return SKILL_ORDER[(SKILL_ORDER.indexOf(latest.skill) + 1) % 4];
}

// Short text for a session: "Cam 19 · T1 · L R W S" (one test) or "L · Cam 19 T1, T2" (one skill over several tests).
export function briefItems(items) {
  if (!items?.length) return "";
  if (items.every((it) => it.book === items[0].book && it.test === items[0].test) && items.length > 1) {
    return `Cam ${items[0].book} · T${items[0].test} · ${items.map((it) => it.skill).join(" ")}`;
  }
  const groups = [];
  for (const it of items) {
    const g = groups.find((x) => x.skill === it.skill && x.book === it.book);
    if (g) g.tests.push(it.test);
    else groups.push({ skill: it.skill, book: it.book, tests: [it.test] });
  }
  return groups.map((g) => `${g.skill} · Cam ${g.book} T${g.tests.join(", T")}`).join(" + ");
}
// Where to open an item: Listening / Reading / Writing have a practice screen; Speaking opens the test panel.
export const itemHref = (it) => (it.skill === "S" ? `#/practice/${it.book}/${it.test}` : `#/practice/${it.book}/${it.test}/${it.skill}`);

// ---- The schedule ----
// settings: stored record or clean settings; attempts: every attempt (deleted ones are ignored); today: "YYYY-MM-DD".
// Returns { settings, todayIsStudy, today: session|null, next: {date, session}|null, week: [7 days], progress, shortfall, ... }.
export function buildSchedule({ settings: rawSettings, attempts = [], today }) {
  const settings = normalizeSettings(rawSettings);
  const live = attempts.filter((a) => !a.deleted);
  const idxAll = indexAttempts(live);
  const idxBefore = indexAttempts(live.filter((a) => !attemptDay(a) || attemptDay(a) < today));
  const isStudy = (iso) => settings.days.includes(isoWeekday(iso));
  const start = rotationStart(live, today);

  // Today's session comes from what was still pending when today began, so it stays put all day long even as you tick items off.
  let todayItems = null;
  let rest;
  if (isStudy(today)) {
    const groups = pack(pendingItems(idxBefore, settings.order), settings, start);
    todayItems = groups[0] ?? null;
    const doneKeys = new Set((todayItems ?? []).map(itemKey));
    const pendingNow = pendingItems(idxAll, settings.order).filter((it) => !doneKeys.has(itemKey(it)));
    const nextStart = todayItems && settings.mode === "skill" ? SKILL_ORDER[(SKILL_ORDER.indexOf(todayItems[0].skill) + 1) % 4] : start;
    rest = pack(pendingNow, settings, nextStart);
  } else {
    rest = pack(pendingItems(idxAll, settings.order), settings, start);
  }
  const sessions = [...(todayItems ? [todayItems] : []), ...rest].map((items) => describeGroup(items, settings));
  const needed = sessions.length;

  // Study days: from today (when it is a study day) up to the day before the exam.
  const last = settings.examDate ? addDays(settings.examDate, -1) : null;
  const bySession = []; // date of each session
  let available = 0;
  {
    let d = today;
    let guard = 0;
    while (guard++ < 800 && (last ? d <= last : bySession.length < needed)) {
      if (isStudy(d)) {
        available++;
        if (bySession.length < needed) bySession.push(d);
      }
      d = addDays(d, 1);
    }
  }
  // Sessions that do not fit before the exam get no date.
  const planned = sessions.map((s, i) => ({ ...s, date: bySession[i] ?? null }));
  const shortfall = settings.examDate ? Math.max(0, needed - available) : 0;

  const byDate = new Map(planned.filter((s) => s.date).map((s) => [s.date, s]));
  const todaySession = todayItems ? planned[0] : null;
  const todayDone = todaySession ? todaySession.items.map((it) => ({ ...it, done: isItemDone(idxAll, it) })) : [];

  // Attempts per day (for the ticks and the "done" lists)
  const doneOn = new Map();
  for (const a of live) {
    const day = attemptDay(a);
    if (!day) continue;
    const list = doneOn.get(day) ?? [];
    list.push({ book: a.book, test: a.test, skill: a.skill });
    doneOn.set(day, list);
  }

  const monday = mondayOf(today);
  const week = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const done = doneOn.get(date) ?? [];
    const study = isStudy(date);
    let state;
    let session = null;
    if (date < today) state = done.length ? "done" : study ? "missed" : "off";
    else if (date === today) {
      session = todaySession;
      const allDone = todaySession && todayDone.every((it) => it.done);
      if (todaySession) state = allDone ? "done" : "today";
      else state = done.length ? "done" : "off";
    } else {
      session = byDate.get(date) ?? null;
      state = session ? "planned" : "off";
    }
    return {
      date, weekday: isoWeekday(date), label: WEEKDAY_LABELS[isoWeekday(date)], state, isToday: date === today, study,
      session, done, doneCount: date === today ? todayDone.filter((it) => it.done).length : done.length,
    };
  });

  const nextDay = planned.find((s) => s.date && s.date > today) ?? null;
  const doneItems = allItems("new").filter((it) => isItemDone(idxAll, it)).length;
  return {
    settings, todayIsStudy: isStudy(today), todaySession: todaySession ? { ...todaySession, items: todayDone } : null,
    next: nextDay ? { date: nextDay.date, session: nextDay } : null,
    week,
    progress: {
      doneItems, total: TOTAL_ITEMS, sessionsNeeded: needed, sessionsAvailable: settings.examDate ? available : needed,
      // today's session is not "left" once it is done
      sessionsLeft: (settings.examDate ? available : needed) - (todaySession && todayDone.every((it) => it.done) ? 1 : 0),
      hasExam: Boolean(settings.examDate),
    },
    shortfall, finished: needed === 0,
  };
}
