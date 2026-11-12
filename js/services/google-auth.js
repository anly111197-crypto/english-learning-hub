// Google Identity Services, token model (spec 7.2). Scope: drive.appdata only.
// The access token lives in module variables ONLY: never in localStorage, IndexedDB, files or logs.
import { GOOGLE_CLIENT_ID, GIS_SRC, DRIVE_SCOPE } from "../config.js";

export class AuthError extends Error {
  // code: "not-ready" | "load" | "timeout" | "superseded" | "scope" | GIS error codes (popup_closed, access_denied, ...)
  constructor(code, message) {
    super(message ?? code);
    this.name = "AuthError";
    this.code = code;
  }
}

let token = null;
let expiresAt = 0;
let client = null;
let pending = null;
let loading = null;

export const isGisReady = () => Boolean(globalThis.google?.accounts?.oauth2);

// Load https://accounts.google.com/gsi/client once. Safe to call repeatedly.
export function loadGis() {
  if (isGisReady()) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => (isGisReady() ? resolve() : reject(new AuthError("load", "Không nạp được dịch vụ đăng nhập Google.")));
    script.onerror = () => {
      script.remove();
      reject(new AuthError("load", "Không nạp được dịch vụ đăng nhập Google."));
    };
    document.head.append(script);
  });
  loading.catch(() => { loading = null; }); // allow a later retry
  return loading;
}

export function validToken() {
  return token && Date.now() < expiresAt ? token : null;
}

export function clearToken() {
  token = null;
  expiresAt = 0;
}

export function revokeToken() {
  const t = token;
  clearToken();
  if (t && isGisReady()) {
    try { globalThis.google.accounts.oauth2.revoke(t, () => {}); } catch { /* best effort */ }
  }
}

function settle(ok, value) {
  const p = pending;
  if (!p) return;
  pending = null;
  clearTimeout(p.timer);
  if (ok) p.resolve(value);
  else p.reject(value);
}

function ensureClient() {
  if (client) return client;
  client = globalThis.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: (resp) => {
      if (resp.error || !resp.access_token) return settle(false, new AuthError(resp.error || "denied"));
      if (!globalThis.google.accounts.oauth2.hasGrantedAllScopes(resp, DRIVE_SCOPE)) {
        return settle(false, new AuthError("scope", "Chưa được cấp quyền lưu dữ liệu ứng dụng trên Drive."));
      }
      token = resp.access_token;
      expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000 - 60000;
      settle(true, token);
    },
    error_callback: (err) => settle(false, new AuthError(err?.type || "popup_failed_to_open")),
  });
  return client;
}

// Ask for a token. Interactive requests (from a click) must call this synchronously inside the click handler:
// Safari iOS blocks the popup if anything is awaited first, so the GIS script has to be loaded beforehand.
// Silent requests (interactive: false) give up after 20 s.
export function requestToken({ interactive = false } = {}) {
  if (pending) {
    if (!interactive) return pending.promise;
    settle(false, new AuthError("superseded"));
  }
  if (!isGisReady()) return Promise.reject(new AuthError("not-ready", "Dịch vụ đăng nhập Google chưa sẵn sàng."));
  const p = {};
  p.promise = new Promise((resolve, reject) => { p.resolve = resolve; p.reject = reject; });
  pending = p;
  if (!interactive) p.timer = setTimeout(() => { if (pending === p) settle(false, new AuthError("timeout")); }, 20000);
  try {
    ensureClient().requestAccessToken({ prompt: "" });
  } catch (e) {
    settle(false, new AuthError("not-ready", e.message));
  }
  return p.promise;
}

// For the sync layer: a valid token, else one silent attempt, else null (the caller shows "Cần đăng nhập lại").
export async function getAccessToken() {
  const t = validToken();
  if (t) return t;
  try {
    await loadGis();
    return await requestToken();
  } catch {
    return null;
  }
}
