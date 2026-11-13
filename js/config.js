// Public configuration. Nothing here is a secret: an OAuth client ID is meant to be shipped in web pages.
// There is no client secret and no backend. Never add tokens, API keys or access codes to this file.

export const GOOGLE_CLIENT_ID = "677368530177-2cc87umoq93ensslcqr60kbuna91a8pd.apps.googleusercontent.com";
export const GIS_SRC = "https://accounts.google.com/gsi/client";

// The only Drive scope the app may use (private app data folder, invisible in the learner's Drive).
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
export const SYNC_FILE_NAME = "elh-data.json";

export const PUSH_DELAY_MS = 5000;        // push after this long without a data change
export const FOCUS_PULL_MIN_MS = 30000;   // pull when the tab regains focus, at most this often
// While the tab is visible: look at the Drive file's modifiedTime this often. Tests can shorten it with ?dev=1&poll=SECONDS
// (like the warm-up clock): the override only exists together with dev=1.
function devPollMs() {
  try {
    const q = new URLSearchParams(location.search);
    const s = Number(q.get("poll"));
    return q.get("dev") === "1" && s > 0 ? s * 1000 : null;
  } catch {
    return null; // no location (node tests)
  }
}
export const POLL_INTERVAL_MS = devPollMs() ?? 60000;

// Speaking recorder (step 8c-1): Part 2 gives 1 minute to prepare and 2 minutes to speak. ?dev=1&prep=2&speak=3 shortens
// them for the e2e scripts (the override only exists together with dev=1).
function devSeconds(name) {
  try {
    const q = new URLSearchParams(location.search);
    const s = Number(q.get(name));
    return q.get("dev") === "1" && s > 0 ? s : null;
  } catch {
    return null; // no location (node tests)
  }
}
export const PART2_PREP_SEC = devSeconds("prep") ?? 60;
export const PART2_SPEAK_SEC = devSeconds("speak") ?? 120;
export const MAX_RECORDINGS = 20; // the newest recordings kept on this device, across all pieces