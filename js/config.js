// Public configuration. Nothing here is a secret: an OAuth client ID is meant to be shipped in web pages.
// There is no client secret and no backend. Never add tokens, API keys or access codes to this file.

export const GOOGLE_CLIENT_ID = "677368530177-2cc87umoq93ensslcqr60kbuna91a8pd.apps.googleusercontent.com";
export const GIS_SRC = "https://accounts.google.com/gsi/client";

// The only Drive scope the app may use (private app data folder, invisible in the learner's Drive).
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
export const SYNC_FILE_NAME = "elh-data.json";

export const PUSH_DELAY_MS = 5000;        // push after this long without a data change
export const FOCUS_PULL_MIN_MS = 30000;   // pull when the tab regains focus, at most this often
