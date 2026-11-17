// Reads and writes the study-schedule settings (store "settings", key "schedule"). The plan itself is never stored.
import { get, put } from "./repo.js";
import { SCHEDULE_KEY, validateSettings } from "./schedule.js";

// The stored record, or null when the learner has not set a schedule up (or deleted it).
export async function loadScheduleRecord() {
  return (await get("settings", SCHEDULE_KEY)) ?? null;
}

// Validates, then saves. Returns { ok, errors, settings }; nothing is written when it is not ok.
export async function saveSchedule(input, today) {
  const result = validateSettings(input, today);
  if (!result.ok) return result;
  const existing = await get("settings", SCHEDULE_KEY, { includeDeleted: true });
  await put("settings", { ...(existing ?? {}), key: SCHEDULE_KEY, ...result.settings, deleted: false });
  return result;
}
