// Sync scheduling and state (spec 7.2). Talks to IndexedDB through repo.js and to Drive through sync-drive.js.
// Events: listens to `elh:data-changed`; announces `elh:sync-state` (detail = state). A pull that changed local data
// dispatches `elh:data-changed` with detail { fromSync: true } so screens reload without triggering another push.
import { exportRaw, replaceAllRaw } from "./repo.js";
import { exportAll, hasLocalData } from "./backup.js";
import { createDriveClient, syncOnce, sameSnapshot, checkRemoteChanged } from "./sync-drive.js";
import { shouldPoll } from "./sync-status.js";
import { getAccessToken, requestToken, loadGis, clearToken, revokeToken, validToken } from "./google-auth.js";
import { PUSH_DELAY_MS, FOCUS_PULL_MIN_MS, POLL_INTERVAL_MS } from "../config.js";

// Flags only: never a token (spec: tokens stay in memory).
const KEY = { connected: "elh.sync.connected", backup: "elh.sync.firstBackup", last: "elh.sync.lastSyncAt" };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

export const isConnected = () => store.get(KEY.connected) === "1";

let state = { status: "off", lastSyncAt: null, message: "" };
export const getSyncState = () => state;

let pollTimer = null;
let remoteModified = null; // modifiedTime of elh-data.json as of the last cycle of this tab; the poll compares against it

function setState(patch) {
  state = { ...state, ...patch };
  document.dispatchEvent(new CustomEvent("elh:sync-state", { detail: state }));
  updatePolling(); // connect, disconnect, needs-login, offline... all start or stop the poll
}

const client = createDriveClient({ fetch: (...args) => globalThis.fetch(...args), getToken: getAccessToken });

// Write the merged data unless the learner saved something since it was read (then syncOnce starts over).
async function writeLocal(merged, base) {
  if (!sameSnapshot(await exportRaw(), base)) return false;
  await replaceAllRaw(merged);
  return true;
}

// First sync on this machine: download a backup of what is here, then MERGE (never replace) with Drive.
async function ensureFirstBackup() {
  if (store.get(KEY.backup) === "1") return;
  if (await hasLocalData()) await exportAll();
  store.set(KEY.backup, "1");
}

function handleError(e) {
  const code = e?.code;
  if (code === "auth") {
    clearToken();
    setState({ status: "needs-login", message: "" });
  } else if (code === "network" || navigator.onLine === false) {
    setState({ status: "offline", message: "" });
  } else if (e?.name === "SyncError") {
    setState({ status: "error", message: e.message });
  } else {
    setState({ status: "error", message: "Không đồng bộ được. Dữ liệu trên máy giữ nguyên." });
  }
  console.warn("sync:", code || e?.name || "error"); // never log tokens or data
}

let lastRunAt = 0;
let inFlight = null;
let again = false;
let pushTimer = null;

async function cycle() {
  lastRunAt = Date.now();
  clearTimeout(pushTimer); // this cycle pushes whatever is pending
  pushTimer = null;
  setState({ status: "syncing" });
  try {
    await ensureFirstBackup();
    const result = await syncOnce({ client, readLocal: exportRaw, writeLocal });
    remoteModified = result.modifiedTime ?? null;
    const iso = new Date().toISOString();
    store.set(KEY.last, iso);
    setState({ status: "synced", lastSyncAt: iso, message: "" });
    if (result.changedLocal) document.dispatchEvent(new CustomEvent("elh:data-changed", { detail: { fromSync: true } }));
  } catch (e) {
    handleError(e);
  }
}

// One cycle (or poll check) at a time in this tab and, with Web Locks, across tabs: the same lock for both.
function runExclusive(fn) {
  const run = navigator.locks ? navigator.locks.request("elh-sync", fn) : fn();
  inFlight = Promise.resolve(run).finally(() => {
    inFlight = null;
    if (again) {
      again = false;
      syncNow();
    }
  });
  return inFlight;
}

// A request made during a cycle reruns it afterwards.
export function syncNow() {
  if (!isConnected()) return Promise.resolve();
  if (inFlight) {
    again = true;
    return inFlight;
  }
  return runExclusive(cycle);
}

// ---- Poll: while the tab is visible, look at the Drive file every 60 s (spec 7.2) ----

const canPoll = () => shouldPoll({ connected: isConnected(), visible: document.visibilityState === "visible", online: navigator.onLine, status: state.status });

// Start the timer when polling is allowed and stop it when it is not (hidden tab, offline, signed out, disconnected).
function updatePolling() {
  if (canPoll()) {
    if (!pollTimer) pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
  } else if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// Only the file's modifiedTime is fetched. Download and merge happen only when it differs from the last cycle (or
// when the last attempt failed, so a recovered connection is noticed at once). Never overlaps a running cycle.
async function pollOnce() {
  if (!canPoll() || inFlight) return;
  runExclusive(async () => {
    if (!canPoll()) return; // the state changed while waiting for the lock
    let check;
    try {
      check = await checkRemoteChanged({ client, lastModified: remoteModified });
    } catch (e) {
      handleError(e);
      return;
    }
    const recovering = state.status === "offline" || state.status === "error";
    if (!check.changed && !recovering) return; // nothing new on Drive: no download, no merge, status line untouched
    await cycle();
  });
}

function schedulePush() {
  if (!isConnected() || state.status === "needs-login") return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; syncNow(); }, PUSH_DELAY_MS);
}

// Many screens write without announcing it, so also look for records newer than the last sync.
let lastDirtyCheck = 0;
async function checkDirty() {
  if (!isConnected() || Date.now() - lastDirtyCheck < 3000) return false;
  lastDirtyCheck = Date.now();
  const since = Date.parse(state.lastSyncAt ?? "") || 0;
  const data = await exportRaw();
  return Object.values(data).some((recs) => recs.some((r) => Date.parse(r.updatedAt) > since));
}

function focusPull() {
  if (!isConnected() || state.status === "needs-login") return;
  if (Date.now() - lastRunAt >= FOCUS_PULL_MIN_MS) syncNow();
}

// Must be called synchronously from a click handler (see google-auth.js). Resolves after the first sync.
export function connect() {
  let asked;
  try {
    asked = requestToken({ interactive: true });
  } catch (e) {
    return Promise.reject(e);
  }
  return asked.then(() => {
    store.set(KEY.connected, "1");
    return syncNow();
  });
}

// Forget the connection on this device: flag and token only, local data stays.
export function disconnect() {
  clearTimeout(pushTimer);
  pushTimer = null;
  revokeToken();
  store.del(KEY.connected);
  store.del(KEY.last);
  setState({ status: "off", lastSyncAt: null, message: "" });
}

export function initSync() {
  document.addEventListener("elh:data-changed", (e) => {
    if (!e.detail?.fromSync) schedulePush();
  });
  window.addEventListener("hashchange", async () => {
    if (await checkDirty()) schedulePush();
  });
  document.addEventListener("visibilitychange", async () => {
    updatePolling();
    if (document.visibilityState === "hidden") {
      if (pushTimer || (await checkDirty())) syncNow(); // leaving: do not wait for the timer
    } else {
      focusPull();
    }
  });
  window.addEventListener("focus", focusPull);
  window.addEventListener("online", () => {
    updatePolling();
    if (isConnected() && (state.status === "offline" || state.status === "error")) syncNow();
  });
  window.addEventListener("offline", () => {
    if (isConnected()) setState({ status: "offline" });
  });

  if (!isConnected()) return; // not connected: no script, no popup
  setState({ status: "syncing", lastSyncAt: store.get(KEY.last) });
  // Load the GIS script now, so a later "Đăng nhập lại" click can call requestAccessToken without awaiting.
  loadGis().then(() => syncNow(), () => handleError({ code: "network" }));
}

export { loadGis, validToken };
