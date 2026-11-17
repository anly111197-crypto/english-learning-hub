import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSchedule, normalizeSettings, validateSettings, isoWeekday, mondayOf, allItems, isItemDone, itemKey, itemHref, TOTAL_ITEMS, DEFAULT_SETTINGS,
} from "../js/services/schedule.js";
import { indexAttempts } from "../js/services/progress.js";
import { mergeData, validateBackup } from "../js/services/merge.js";
import { STORE_NAMES, APP_ID } from "../js/services/schema.js";

const TUE = "2026-11-17"; // a Tuesday
const att = (book, testNo, skill, date, extra = {}) => ({
  id: `${book}-${testNo}-${skill}${extra.task ?? ""}`, book, test: testNo, skill, band: 6.5, date,
  createdAt: `${date}T10:00:00Z`, updatedAt: `${date}T10:00:00Z`, deleted: false, ...extra,
});
const settings = (over = {}) => ({ ...DEFAULT_SETTINGS, ...over });
const sch = (over = {}, attempts = [], today = TUE) => buildSchedule({ settings: settings(over), attempts, today });
const keys = (session) => (session ? session.items.map(itemKey) : null);
const weekKeys = (s) => s.week.map((d) => (d.session ? keys(d.session).join("+") : null));

test("dates: weekday numbers, Monday of the week, the 160 items", () => {
  assert.equal(isoWeekday("2026-11-16"), 1);
  assert.equal(isoWeekday(TUE), 2);
  assert.equal(isoWeekday("2026-11-22"), 7);
  assert.equal(mondayOf("2026-12-02"), "2026-11-30"); // a week that runs over the month end
  assert.equal(TOTAL_ITEMS, 160);
  assert.equal(allItems("new").length, 160);
  assert.equal(itemKey(allItems("new")[0]), "19-1-L");
  assert.equal(itemKey(allItems("old")[0]), "10-1-L");
});

test("settings: defaults for anything missing or broken", () => {
  assert.deepEqual(normalizeSettings(null), { examDate: "", days: [1, 2, 3, 4, 5], minutes: 60, mode: "skill", order: "new" });
  const s = normalizeSettings({ examDate: "garbage", days: [7, 3, 3, 9, "x"], minutes: -5, mode: "test", order: "old" });
  assert.deepEqual(s, { examDate: "", days: [3, 7], minutes: 60, mode: "test", order: "old" });
});

test("settings validation: at least 30 minutes, a past exam date is refused, at least one day", () => {
  const ok = validateSettings({ examDate: "", days: [1], minutes: "60", mode: "skill", order: "new" }, TUE);
  assert.equal(ok.ok, true);
  assert.equal(ok.settings.minutes, 60);
  for (const m of [15, 29, 0, "abc", ""]) {
    const r = validateSettings({ days: [1], minutes: m }, TUE);
    assert.equal(r.ok, false, String(m));
    assert.equal(r.errors[0].field, "minutes");
  }
  assert.match(validateSettings({ days: [1], minutes: 15 }, TUE).errors[0].message, /tối thiểu 30/);
  assert.equal(validateSettings({ days: [1], minutes: 30 }, TUE).ok, true);
  const past = validateSettings({ examDate: "2026-11-16", days: [1], minutes: 60 }, TUE);
  assert.equal(past.ok, false);
  assert.equal(past.errors[0].field, "examDate");
  assert.match(past.errors[0].message, /quá khứ/);
  assert.equal(validateSettings({ examDate: TUE, days: [1], minutes: 60 }, TUE).ok, true); // today is allowed
  assert.equal(validateSettings({ examDate: "2026-02-31", days: [1], minutes: 60 }, TUE).ok, false);
  assert.equal(validateSettings({ days: [], minutes: 60 }, TUE).errors[0].field, "days");
});

test("skills rotate L -> R -> W -> S, newest Cambridge book first, Speaking packs 3 items", () => {
  const s = sch();
  assert.deepEqual(keys(s.todaySession), ["19-1-L"]);
  // Tue L, Wed R, Thu W, Fri S (3 items), then Mon L again
  assert.deepEqual(weekKeys(s), [null, "19-1-L", "19-1-R", "19-1-W", "19-1-S+19-2-S+19-3-S", null, null]);
  assert.equal(s.week[0].state, "missed");
  assert.equal(s.next.date, "2026-11-18");
  const next = sch({}, [], "2026-11-23"); // the following Monday, same attempts
  assert.deepEqual(keys(next.todaySession), ["19-1-L"]);
});

test("a skill is never studied on two study days in a row while others remain", () => {
  const s = sch({ days: [1, 2, 3, 4, 5, 6, 7] });
  const skills = s.week.map((d) => d.session?.items[0].skill).filter(Boolean);
  for (let i = 1; i < skills.length; i++) assert.notEqual(skills[i], skills[i - 1]);
});

test("every session starts with the 15 minute warm-up; items that do not fit say they can be split", () => {
  const s = sch();
  assert.equal(s.todaySession.warmupMinutes, 15);
  assert.equal(s.todaySession.note, ""); // Listening 40' fits 60 - 15
  const reading = s.week[2].session; // Wed R = 60'
  assert.equal(reading.itemMinutes, 60);
  assert.equal(reading.totalMinutes, 75);
  assert.equal(reading.note, "có thể chia 2 lần");
  assert.equal(s.week[4].session.note, ""); // 3 x 15' fits
  const longer = sch({ minutes: 120 });
  assert.equal(longer.week[2].session.note, "");
  const shorter = sch({ minutes: 30 }); // 15' for items: Speaking packs only 1
  assert.equal(keys(shorter.week[4].session).length, 1);
});

test("items with a score are skipped (Writing counts with Task 1 or Task 2)", () => {
  const attempts = [att(19, 1, "L", "2026-11-10"), att(19, 1, "R", "2026-11-10"), att(19, 1, "W", "2026-11-11", { task: 1 })];
  const s = sch({}, attempts);
  // the latest earlier attempt was Writing, so the rotation goes on with Speaking
  assert.deepEqual(weekKeys(s), [null, "19-1-S+19-2-S+19-3-S", "19-2-L", "19-2-R", "19-2-W", null, null]);
  assert.equal(s.progress.doneItems, 3);
  assert.equal(s.progress.total, 160);
  assert.equal(isItemDone(indexAttempts(attempts), { book: 19, test: 1, skill: "W" }), true);
  assert.equal(isItemDone(indexAttempts(attempts), { book: 19, test: 1, skill: "S" }), false);
});

test("the rotation continues after the skill of the latest earlier attempt", () => {
  const s = sch({}, [att(19, 1, "R", "2026-11-14")]);
  assert.equal(s.todaySession.items[0].skill, "W");
});

test("a missed session is not piled up: what is left simply moves to the next study day", () => {
  // Monday 16/11 was a study day with nothing done: it shows as missed and today starts from the same first item
  const s = sch();
  assert.equal(s.week[0].state, "missed");
  assert.deepEqual(keys(s.todaySession), ["19-1-L"]);
  // two weeks later without any attempt the plan is the same: nothing was queued up
  const later = sch({}, [], "2026-12-01");
  assert.deepEqual(keys(later.todaySession), ["19-1-L"]);
  assert.equal(later.progress.sessionsNeeded, s.progress.sessionsNeeded);
});

test("a day with an attempt dated that day is ticked, an earlier day without one is missed", () => {
  const s = sch({}, [att(18, 2, "L", "2026-11-16")]);
  assert.equal(s.week[0].state, "done");
  assert.deepEqual(s.week[0].done.map(itemKey), ["18-2-L"]);
  assert.equal(s.week[0].doneCount, 1);
  const skipped = sch({ days: [1, 2, 3, 4, 5, 6, 7] });
  assert.equal(skipped.week[0].state, "missed");
  assert.equal(skipped.week[5].state, "planned"); // Saturday is in the future
});

test("today's session stays the same while you tick items off; tomorrow's plan moves on", () => {
  const before = sch();
  const after = sch({}, [att(19, 1, "L", TUE)]);
  assert.deepEqual(keys(after.todaySession), keys(before.todaySession));
  assert.equal(after.todaySession.items[0].done, true);
  assert.equal(after.week[1].state, "done");
  assert.equal(after.progress.sessionsLeft, before.progress.sessionsLeft - 1);
  assert.deepEqual(weekKeys(after).slice(2, 5), weekKeys(before).slice(2, 5)); // the rest of the week is unchanged
});

test("something done ahead of the plan is not planned again", () => {
  const s = sch({}, [att(19, 1, "R", TUE)]); // Reading done today although Listening was planned
  assert.deepEqual(keys(s.todaySession), ["19-1-L"]);
  assert.ok(!weekKeys(s).includes("19-1-R"));
  assert.deepEqual(keys(s.week[2].session), ["19-2-R"]);
});

test("not a study day: 'rest today' and the next session", () => {
  const s = sch({ days: [1, 3] }); // Mon and Wed; today is Tuesday
  assert.equal(s.todayIsStudy, false);
  assert.equal(s.todaySession, null);
  assert.equal(s.next.date, "2026-11-18");
  assert.deepEqual(keys(s.next.session), ["19-1-L"]);
  assert.equal(s.week[1].state, "off");
});

test("enough sessions before the exam: no warning", () => {
  const s = sch({ examDate: "2027-06-30", days: [1, 2, 3, 4, 5, 6, 7] });
  assert.equal(s.shortfall, 0);
  assert.equal(s.progress.hasExam, true);
  assert.ok(s.progress.sessionsAvailable >= s.progress.sessionsNeeded);
  assert.equal(s.progress.sessionsLeft, s.progress.sessionsAvailable);
});

test("too few sessions before the exam: the shortfall is counted", () => {
  const s = sch({ examDate: "2026-11-20" }); // study days before it: Tue, Wed, Thu
  assert.equal(s.progress.sessionsAvailable, 3);
  assert.equal(s.shortfall, s.progress.sessionsNeeded - 3);
  assert.ok(s.shortfall > 0);
  assert.equal(s.week.filter((d) => d.session).length, 3);
  const more = sch({ examDate: "2026-11-20", days: [1, 2, 3, 4, 5, 6, 7] });
  assert.equal(more.progress.sessionsAvailable, 3); // the exam day itself is not a study day
});

test("no exam date: spread evenly with no deadline and no warning", () => {
  const s = sch();
  assert.equal(s.progress.hasExam, false);
  assert.equal(s.shortfall, 0);
  assert.equal(s.progress.sessionsLeft, s.progress.sessionsNeeded);
  assert.ok(s.progress.sessionsNeeded > 100);
});

test("a week that runs over the month end", () => {
  const s = sch({ days: [1, 2, 3, 4, 5, 6, 7] }, [], "2026-12-02");
  assert.deepEqual(s.week.map((d) => d.date), ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"]);
  assert.deepEqual(s.week.map((d) => d.label), ["T2", "T3", "T4", "T5", "T6", "T7", "CN"]);
  assert.equal(s.week[2].isToday, true);
  assert.equal(s.week[0].state, "missed");
  assert.equal(s.week[3].state, "planned");
});

test("whole-test mode: one session per test with all missing skills, flagged as splittable", () => {
  const s = sch({ mode: "test", order: "old" });
  assert.deepEqual(keys(s.todaySession), ["10-1-L", "10-1-R", "10-1-W", "10-1-S"]);
  assert.equal(s.todaySession.note, "chia nhiều lần");
  assert.equal(s.todaySession.itemMinutes, 175);
  assert.deepEqual(keys(s.week[2].session)[0], "10-2-L");
  const part = sch({ mode: "test", order: "old" }, [att(10, 1, "L", "2026-11-10"), att(10, 1, "S", "2026-11-10")]);
  assert.deepEqual(keys(part.todaySession), ["10-1-R", "10-1-W"]);
});

test("old books first when asked", () => {
  const s = sch({ order: "old" });
  assert.deepEqual(keys(s.todaySession), ["10-1-L"]);
});

test("everything done: nothing to plan", () => {
  const all = allItems("new").map((it) => att(it.book, it.test, it.skill, "2026-11-01", it.skill === "W" ? { task: 2 } : {}));
  const s = sch({}, all);
  assert.equal(s.finished, true);
  assert.equal(s.todaySession, null);
  assert.equal(s.progress.doneItems, 160);
});

test("deleted attempts do not count", () => {
  const s = sch({}, [att(19, 1, "L", "2026-11-10", { deleted: true })]);
  assert.deepEqual(keys(s.todaySession), ["19-1-L"]);
});

test("Speaking opens the test panel, the other skills open the practice screen", () => {
  assert.equal(itemHref({ book: 17, test: 2, skill: "S" }), "#/practice/17/2");
  assert.equal(itemHref({ book: 17, test: 2, skill: "R" }), "#/practice/17/2/R");
  assert.equal(itemHref({ book: 17, test: 2, skill: "W" }), "#/practice/17/2/W");
});

// ---- Storage: the settings store in backups and merges ----
const emptyData = () => Object.fromEntries(STORE_NAMES.map((s) => [s, []]));
const settingRec = (updatedAt, extra) => ({ key: "schedule", createdAt: "2026-01-01T00:00:00Z", updatedAt, deleted: false, ...DEFAULT_SETTINGS, ...extra });

test("a backup of schema 2 (no settings store) is still accepted and restores an empty settings store", () => {
  const out = validateBackup({ app: APP_ID, schemaVersion: 2, exportedAt: "2026-11-01T00:00:00Z", data: { vocab: [] } });
  assert.deepEqual(out.settings, []);
  assert.equal(Object.keys(out).length, STORE_NAMES.length);
});

test("a backup with settings validates, a duplicate key is refused", () => {
  const rec = settingRec("2026-11-01T00:00:00Z");
  const out = validateBackup({ app: APP_ID, schemaVersion: 3, data: { settings: [rec] } });
  assert.equal(out.settings[0].key, "schedule");
  assert.throws(() => validateBackup({ app: APP_ID, schemaVersion: 3, data: { settings: [rec, rec] } }), /trùng key/);
});

test("a file newer than this app says how to update", () => {
  assert.throws(() => validateBackup({ app: APP_ID, schemaVersion: 4, data: {} }), /Tải lại trang 2–3 lần; nếu đã cài ra màn hình chính thì đóng hẳn app rồi mở lại/);
});

test("merging: the newer schedule wins as a whole, a tombstone is kept, nothing is lost", () => {
  const local = { ...emptyData(), settings: [settingRec("2026-11-02T00:00:00Z", { minutes: 90 })] };
  const incoming = { ...emptyData(), settings: [settingRec("2026-11-05T00:00:00Z", { minutes: 45, days: [6, 7] })] };
  const out = mergeData(local, incoming, { now: Date.parse("2026-11-12T00:00:00Z") });
  assert.equal(out.settings.length, 1);
  assert.equal(out.settings[0].minutes, 45);
  assert.deepEqual(out.settings[0].days, [6, 7]);
  const older = mergeData(incoming, local, { now: Date.parse("2026-11-12T00:00:00Z") });
  assert.equal(older.settings[0].minutes, 45);
  const onlyOne = mergeData({ ...emptyData() }, local, { now: Date.parse("2026-11-12T00:00:00Z") });
  assert.equal(onlyOne.settings[0].minutes, 90);
});

test("briefItems: a short line for a session", async () => {
  const { briefItems } = await import("../js/services/schedule.js");
  assert.equal(briefItems([{ book: 19, test: 1, skill: "L" }]), "L · Cam 19 T1");
  assert.equal(briefItems([{ book: 19, test: 1, skill: "S" }, { book: 19, test: 2, skill: "S" }, { book: 19, test: 3, skill: "S" }]), "S · Cam 19 T1, T2, T3");
  assert.equal(briefItems([{ book: 10, test: 1, skill: "L" }, { book: 10, test: 1, skill: "R" }, { book: 10, test: 1, skill: "W" }, { book: 10, test: 1, skill: "S" }]), "Cam 10 · T1 · L R W S");
  assert.equal(briefItems([]), "");
});