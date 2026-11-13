// Pure text for the sync status line (spec 7.2). No DOM, no storage.

export function agoText(iso, nowMs = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const minutes = Math.max(0, Math.floor((nowMs - t) / 60000));
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}

// state: { status: "off" | "syncing" | "synced" | "offline" | "needs-login" | "error", lastSyncAt?, message? }
// -> { text, level }  (level: off | ok | busy | warn)
export function describeSync(state, nowMs = Date.now()) {
  switch (state?.status) {
    case "syncing":
      return { text: "Đang đồng bộ", level: "busy" };
    case "synced": {
      const ago = state.lastSyncAt ? agoText(state.lastSyncAt, nowMs) : "";
      return { text: ago ? `Đã đồng bộ · ${ago}` : "Đã đồng bộ", level: "ok" };
    }
    case "offline":
      return { text: "Offline", level: "warn" };
    case "needs-login":
      return { text: "Cần đăng nhập lại", level: "warn" };
    case "error":
      return { text: "Lỗi đồng bộ", level: "warn" };
    default:
      return { text: "Chưa kết nối Drive", level: "off" };
  }
}

// The 60-second poll runs only while the learner can see the tab, is online, and is connected and signed in.
// It stops (not just skips) as soon as one of these stops being true.
export function shouldPoll({ connected, visible, online, status }) {
  return Boolean(connected) && visible === true && online !== false && status !== "needs-login" && status !== "off";
}