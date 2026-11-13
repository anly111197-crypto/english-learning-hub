// Speaking recorder (spec 5.6): the clock of each Part, which recordings to drop, microphone messages, the
// "auto transcribe" default. Pure: no DOM, no IndexedDB, no microphone. Runs under `node --test`.

export const DEFAULT_PLAN = { prepSec: 60, speakSec: 120 };

// ---- Clock ----
// Part 2: a preparation countdown (no recording yet), then a speaking countdown, then "Quá giờ" counting up (the
// recording is NOT cut). Parts 1 and 3: counting up. `elapsedSec` counts from the moment the learner pressed Ghi âm.
// Returns { phase: "prepare" | "speak" | "over" | "up", seconds, label, text }.
export function partClock(part, elapsedSec, plan = DEFAULT_PLAN) {
  const elapsed = Math.max(0, Number(elapsedSec) || 0);
  if (Number(part) === 2) {
    const { prepSec, speakSec } = plan;
    if (elapsed < prepSec) return { phase: "prepare", seconds: Math.ceil(prepSec - elapsed), label: "Chuẩn bị", text: formatClock(Math.ceil(prepSec - elapsed)) };
    if (elapsed < prepSec + speakSec) {
      const left = Math.ceil(prepSec + speakSec - elapsed);
      return { phase: "speak", seconds: left, label: "Đang nói", text: formatClock(left) };
    }
    const over = Math.floor(elapsed - prepSec - speakSec);
    return { phase: "over", seconds: over, label: "Quá giờ", text: `+${formatClock(over)}` };
  }
  const up = Math.floor(elapsed);
  return { phase: "up", seconds: up, label: "Đang ghi", text: formatClock(up) };
}

export function formatClock(totalSec) {
  const s = Math.max(0, Math.floor(Number(totalSec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// What the clock says before anything is pressed.
export function idleHint(part, plan = DEFAULT_PLAN) {
  return Number(part) === 2
    ? `Part 2: ${formatClock(plan.prepSec)} chuẩn bị, rồi ${formatClock(plan.speakSec)} nói`
    : `Part ${Number(part) === 3 ? 3 : 1}: đồng hồ đếm lên`;
}

// ---- Keeping only the newest recordings ----
// recordings: [{ id, createdAt }] of the whole device. Returns the ids to delete: everything beyond the `max` newest.
export function pickRecordingsToDelete(recordings, max = 20) {
  const newestFirst = [...recordings].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)));
  return newestFirst.slice(Math.max(0, max)).map((r) => r.id);
}

// ---- MediaRecorder format ----
export const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

// The first format the browser can record, or "" (then let the browser choose).
export function chooseMimeType(isSupported, candidates = MIME_CANDIDATES) {
  for (const type of candidates) {
    try {
      if (isSupported(type)) return type;
    } catch { /* treat as unsupported */ }
  }
  return "";
}

// ---- Microphone messages (shown after a failed getUserMedia) ----
export function micErrorMessage(name) {
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "Trình duyệt đang chặn micro. Để bật lại: bấm biểu tượng ổ khóa cạnh địa chỉ trang, chọn Micro rồi Cho phép, sau đó bấm Ghi âm lại. Trên iPhone hoặc iPad: Cài đặt, Safari, Micro (hoặc nút aA trên thanh địa chỉ, Cài đặt trang web, Micro).";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "Không tìm thấy micro. Hãy cắm hoặc bật micro rồi thử lại.";
    case "NotReadableError":
    case "AbortError":
    case "TrackStartError":
      return "Không dùng được micro: có thể ứng dụng khác đang dùng nó. Đóng ứng dụng đó rồi thử lại.";
    default:
      return "Không bật được micro. Hãy thử lại.";
  }
}

export const UNSUPPORTED_MESSAGE = "Trình duyệt này không hỗ trợ ghi âm. Hãy dùng Chrome, Edge hoặc Safari bản mới.";

// ---- Speech to text ----
export const SPEECH_LANGS = ["en-GB", "en-US"];
export const normalizeSpeechLang = (value) => (SPEECH_LANGS.includes(value) ? value : "en-GB");

// Text typed before recording + what was recognised so far (final) + the words still being recognised (interim).
export function appendDictation(base, finalText, interimText = "") {
  return [String(base ?? "").trimEnd(), String(finalText ?? "").trim(), String(interimText ?? "").trim()].filter(Boolean).join(" ");
}

// iPhone, iPad and iPod, including an iPad that says it is a Mac (it has a Mac platform but touch points).
export function isAppleTouch({ userAgent = "", platform = "", maxTouchPoints = 0 } = {}) {
  return /iPhone|iPad|iPod/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

// "Tự chuyển thành chữ": on by default on computers, off on iPhone / iPad (the microphone is shared with the recorder
// there). A saved choice wins: "1" on, "0" off.
export function readAutoTranscribe(saved, env) {
  if (saved === "1") return true;
  if (saved === "0") return false;
  return !isAppleTouch(env);
}
