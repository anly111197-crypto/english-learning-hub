// Recorder block of the Speaking screen (spec 5.6): Ghi âm / Dừng / Nghe lại, the clock of the Part, speech to text,
// the list of saved recordings. The microphone is requested only when Ghi âm is pressed.
// Everything stays on this device: the audio goes to IndexedDB (services/recording-ops.js), never to the backup or Drive.
import { h } from "./dom.js";
import { showToast } from "./toast.js";
import { confirmModal } from "./modal.js";
import { PART2_PREP_SEC, PART2_SPEAK_SEC } from "../config.js";
import {
  partClock, formatClock, idleHint, chooseMimeType, micErrorMessage, UNSUPPORTED_MESSAGE, appendDictation,
  normalizeSpeechLang, readAutoTranscribe,
} from "../services/recorder.js";
import { saveRecording, listRecordings, deleteRecording, recordingBlob } from "../services/recording-ops.js";

const PLAN = { prepSec: PART2_PREP_SEC, speakSec: PART2_SPEAK_SEC };
const KEY_AUTO = "elh.autoTranscribe";
const KEY_LANG = "elh.speechLang";

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};
const speechApi = () => globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
const canRecord = () => Boolean(navigator.mediaDevices?.getUserMedia) && typeof globalThis.MediaRecorder === "function";
const fmtDate = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fmtSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// ctx: { part() -> 1|2|3, ensureSubmission() -> Promise<id>, getText(), setText(text), setReadOnly(bool) }
export function mountRecorder(container, ctx) {
  const st = {
    phase: "idle", // idle | preparing | recording | saving
    stream: null, rec: null, chunks: [], mime: "", clockStart: 0, recStart: 0, ticker: null, takePart: 1, submissionId: null,
    sr: null, srWanted: false, srRestarts: 0, dictBase: "", dictFinal: "",
    urls: [], destroyed: false,
  };
  const Speech = speechApi();

  const clock = h("span", { class: "rec-time nowrap", role: "timer", dataset: { role: "rec-clock" } }, "0:00");
  const clockLabel = h("span", { class: "rec-label nowrap", dataset: { role: "rec-label" } }, "");
  const status = h("p", { class: "form-hint rec-status", role: "status", dataset: { role: "rec-status" } });
  const error = h("p", { class: "form-error rec-error", role: "alert", hidden: true, dataset: { role: "rec-error" } });
  const speechNote = h("p", { class: "form-hint rec-speech-note", role: "status", dataset: { role: "rec-speech-note" } });
  const list = h("ul", { class: "rec-list", dataset: { role: "rec-list" } });

  const bRecord = h("button", { type: "button", class: "btn btn-primary", dataset: { role: "rec-start" }, onClick: onRecord }, "Ghi âm");
  const bStop = h("button", { type: "button", class: "btn btn-outline", dataset: { role: "rec-stop" }, disabled: true, onClick: () => stopAll() }, "Dừng");
  const bReplay = h("button", { type: "button", class: "btn btn-outline", dataset: { role: "rec-replay" }, disabled: true, onClick: replayLatest }, "Nghe lại");
  const bSkip = h("button", { type: "button", class: "btn btn-text", hidden: true, dataset: { role: "rec-skip" }, onClick: skipPrep }, "Bỏ qua chuẩn bị");

  // Speech to text: hidden when the browser has none (recording still works).
  let autoBox = null;
  let langSel = null;
  let speechBlock = null;
  if (Speech) {
    autoBox = h("input", { type: "checkbox", id: "rec-auto", dataset: { role: "rec-auto" }, checked: readAutoTranscribe(store.get(KEY_AUTO), navigator) });
    autoBox.addEventListener("change", () => store.set(KEY_AUTO, autoBox.checked ? "1" : "0"));
    langSel = h("select", { class: "input rec-lang", "aria-label": "Giọng nhận dạng", dataset: { role: "rec-lang" } },
      h("option", { value: "en-GB" }, "en-GB"), h("option", { value: "en-US" }, "en-US"));
    langSel.value = normalizeSpeechLang(store.get(KEY_LANG));
    langSel.addEventListener("change", () => store.set(KEY_LANG, langSel.value));
    speechBlock = h("div", { class: "rec-speech", dataset: { role: "rec-speech" } },
      h("label", { class: "rec-auto-line", for: "rec-auto" }, autoBox, h("span", {}, "Tự chuyển thành chữ")),
      langSel,
      h("p", { class: "form-hint rec-speech-info" },
        "Chuyển giọng nói thành chữ do trình duyệt xử lý (Chrome có thể gửi âm thanh tới máy chủ của Google, Safari tới Apple; app không gửi đi đâu)."),
      speechNote);
  }

  const root = h("section", { class: "ai-recorder", "aria-label": "Ghi âm", dataset: { role: "recorder" } },
    h("h2", { class: "ai-tray-title" }, "Ghi âm"),
    h("div", { class: "rec-clock" }, clock, clockLabel),
    h("div", { class: "rec-buttons" }, bRecord, bStop, bReplay, bSkip),
    status, error, speechBlock,
    list,
    h("p", { class: "form-hint" }, "Ghi âm chỉ lưu trên máy này (không vào file sao lưu và không đồng bộ Drive); giữ tối đa 20 bản gần nhất, bản cũ nhất tự bị xoá."));
  container.replaceChildren(root);
  if (!canRecord()) {
    bRecord.disabled = true;
    error.textContent = UNSUPPORTED_MESSAGE;
    error.hidden = false;
  }

  // ---- Clock ----
  function elapsed() {
    return (Date.now() - st.clockStart) / 1000;
  }
  function paintClock() {
    if (st.phase === "idle" || st.phase === "saving") {
      clock.textContent = "0:00";
      clockLabel.textContent = idleHint(ctx.part(), PLAN);
      clock.dataset.phase = "idle";
      return;
    }
    const c = partClock(st.takePart, elapsed(), PLAN);
    clock.textContent = c.text;
    clockLabel.textContent = c.label;
    clock.dataset.phase = c.phase;
  }
  function tick() {
    if (st.phase === "preparing" && elapsed() >= PLAN.prepSec) beginRecording();
    paintClock();
  }
  function setPhase(phase) {
    st.phase = phase;
    const busy = phase === "preparing" || phase === "recording" || phase === "saving";
    bRecord.disabled = busy || !canRecord();
    bStop.disabled = !(phase === "preparing" || phase === "recording");
    bSkip.hidden = phase !== "preparing";
    if (autoBox) autoBox.disabled = busy;
    if (langSel) langSel.disabled = busy;
    root.dataset.phase = phase;
    refreshReplay();
    paintClock();
  }
  const showError = (msg) => { error.textContent = msg; error.hidden = !msg; };

  // ---- Start / stop ----
  async function onRecord() {
    showError("");
    status.textContent = "";
    speechNote.textContent = "";
    if (!canRecord()) { showError(UNSUPPORTED_MESSAGE); return; }
    st.takePart = ctx.part();
    let stream;
    try {
      // the very first await of the click: Safari only opens the permission prompt inside the gesture
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      showError(micErrorMessage(e?.name));
      return;
    }
    if (st.destroyed) { stopTracks(stream); return; }
    try {
      st.submissionId = await ctx.ensureSubmission();
    } catch (e) {
      stopTracks(stream);
      showError(e.message || "Không tạo được bài để gắn bản ghi âm.");
      return;
    }
    st.stream = stream;
    st.clockStart = Date.now();
    clearInterval(st.ticker);
    st.ticker = setInterval(tick, 250);
    if (st.takePart === 2 && PLAN.prepSec > 0) {
      setPhase("preparing");
      status.textContent = "Đang chuẩn bị: micro đã sẵn sàng, chưa ghi. Hết giờ chuẩn bị app tự ghi.";
    } else {
      beginRecording();
    }
  }

  function skipPrep() {
    if (st.phase !== "preparing") return;
    st.clockStart -= Math.max(0, PLAN.prepSec - elapsed()) * 1000; // jump to the end of the preparation
    beginRecording();
  }

  function beginRecording() {
    if (st.phase === "recording" || !st.stream) return;
    st.mime = chooseMimeType((t) => globalThis.MediaRecorder.isTypeSupported?.(t));
    let rec;
    try {
      rec = new globalThis.MediaRecorder(st.stream, st.mime ? { mimeType: st.mime } : undefined);
    } catch (e) {
      stopTracks(st.stream);
      st.stream = null;
      clearInterval(st.ticker);
      setPhase("idle");
      showError("Không bắt đầu ghi âm được: " + (e?.message || "lỗi không rõ") + ".");
      return;
    }
    st.rec = rec;
    st.chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) st.chunks.push(e.data); };
    rec.onstop = () => finishTake();
    rec.onerror = () => { showError("Ghi âm bị lỗi giữa chừng."); stopAll(); };
    st.recStart = Date.now();
    rec.start(1000); // a chunk every second: little is lost if the page dies
    setPhase("recording");
    status.textContent = "Đang ghi âm…";
    startSpeech();
  }

  // Stop whatever is going on. A recording in progress is saved; a preparation just ends.
  function stopAll() {
    if (st.phase === "preparing") {
      endCapture();
      setPhase("idle");
      status.textContent = "Đã dừng, chưa ghi bản nào.";
      return;
    }
    if (st.phase !== "recording") return;
    setPhase("saving");
    stopSpeech();
    try { st.rec.stop(); } catch { finishTake(); } // onstop -> finishTake
  }

  function endCapture() {
    clearInterval(st.ticker);
    st.ticker = null;
    stopTracks(st.stream);
    st.stream = null;
  }

  async function finishTake() {
    const durationSec = (Date.now() - st.recStart) / 1000;
    const type = st.rec?.mimeType || st.mime || "audio/webm";
    const blob = new Blob(st.chunks, { type });
    st.chunks = [];
    endCapture();
    st.rec = null;
    try {
      if (blob.size === 0) throw new Error("Không thu được âm thanh nào.");
      await saveRecording({ submissionId: st.submissionId, part: st.takePart, durationSec, mimeType: type, blob });
      status.textContent = `Đã lưu bản ghi (${formatClock(durationSec)}).`;
      await refreshList();
    } catch (e) {
      showError(e.message || "Không lưu được bản ghi âm.");
    }
    if (!st.destroyed) setPhase("idle");
  }

  const stopTracks = (stream) => stream?.getTracks().forEach((t) => t.stop());

  // ---- Speech to text ----
  function startSpeech() {
    if (!Speech || !autoBox?.checked) return;
    st.dictBase = ctx.getText();
    st.dictFinal = "";
    st.srWanted = true;
    st.srRestarts = 0;
    ctx.setReadOnly(true);
    speechNote.textContent = "Đang chuyển giọng nói thành chữ…";
    launchSpeech();
  }

  function launchSpeech() {
    if (!st.srWanted) return;
    const sr = new Speech();
    sr.lang = normalizeSpeechLang(langSel?.value);
    sr.continuous = true;
    sr.interimResults = true;
    sr.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) st.dictFinal = appendDictation("", st.dictFinal, r[0].transcript);
        else interim += r[0].transcript;
      }
      ctx.setText(appendDictation(st.dictBase, st.dictFinal, interim));
    };
    sr.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      st.srWanted = false; // not allowed / no network / no service: the recording itself goes on
      speechNote.textContent = e.error === "network"
        ? "Không chuyển được giọng nói thành chữ (cần kết nối mạng). Vẫn đang ghi âm."
        : "Không chuyển được giọng nói thành chữ trên trình duyệt này. Vẫn đang ghi âm.";
      ctx.setReadOnly(false);
    };
    sr.onend = () => {
      // Chrome ends a recognition by itself after a pause: start the next one while the recording goes on.
      if (st.srWanted && st.phase === "recording" && st.srRestarts < 100) {
        st.srRestarts += 1;
        setTimeout(launchSpeech, 150);
      }
    };
    st.sr = sr;
    try { sr.start(); } catch { st.srWanted = false; ctx.setReadOnly(false); }
  }

  function stopSpeech() {
    const wasOn = st.srWanted || st.sr;
    st.srWanted = false;
    if (st.sr) {
      const sr = st.sr;
      st.sr = null;
      sr.onend = null;
      try { sr.stop(); } catch { /* already stopped */ }
    }
    if (wasOn) {
      ctx.setText(appendDictation(st.dictBase, st.dictFinal, ""));
      ctx.setReadOnly(false);
      speechNote.textContent = st.dictFinal ? "Đã điền chữ vào ô transcript, bạn có thể sửa lại." : "";
    }
  }

  // ---- Saved recordings ----
  function revokeUrls() {
    for (const u of st.urls) URL.revokeObjectURL(u);
    st.urls = [];
  }

  async function refreshList() {
    const id = ctx.currentSubmissionId?.() ?? st.submissionId;
    const rows = await listRecordings(id);
    if (st.destroyed) return;
    revokeUrls();
    list.replaceChildren(...rows.map((r) => {
      const url = URL.createObjectURL(recordingBlob(r));
      st.urls.push(url);
      return h("li", { class: "rec-item", dataset: { id: r.id } },
        h("p", { class: "rec-item-meta" }, `${fmtDate(r.createdAt)} · Part ${r.part} · ${formatClock(r.durationSec)} · ${fmtSize(r.size)}`),
        h("audio", { controls: true, preload: "metadata", src: url, "aria-label": "Nghe lại bản ghi" }),
        h("button", {
          type: "button", class: "btn btn-text btn-sm", dataset: { role: "rec-delete" },
          onClick: async () => {
            const ok = await confirmModal({ title: "Xoá ghi âm", message: "Xoá bản ghi âm này khỏi máy? Không thể hoàn tác.", confirmLabel: "Xoá", danger: true });
            if (!ok) return;
            await deleteRecording(r.id);
            showToast("Đã xoá ghi âm.");
            await refreshList();
          },
        }, "Xoá ghi âm"));
    }));
    refreshReplay();
  }

  function refreshReplay() {
    bReplay.disabled = st.phase !== "idle" || list.children.length === 0;
  }

  function replayLatest() {
    const audio = list.querySelector("audio");
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }

  // A tab that goes to the background cannot keep recording on every device: keep what was recorded so far.
  const onHidden = () => { if (document.visibilityState === "hidden" && (st.phase === "recording" || st.phase === "preparing")) { status.textContent = "Tab bị ẩn nên đã dừng và lưu phần đã ghi."; stopAll(); } };
  document.addEventListener("visibilitychange", onHidden);

  setPhase("idle");
  refreshList().catch(() => {});

  return {
    // Call when the part or the open piece changes.
    refresh() {
      if (st.phase === "idle") paintClock();
      return refreshList();
    },
    destroy() {
      st.destroyed = true;
      document.removeEventListener("visibilitychange", onHidden);
      if (st.phase === "recording") { stopSpeech(); try { st.rec.stop(); } catch { /* ignore */ } } // onstop saves the take
      else { stopSpeech(); endCapture(); }
      clearInterval(st.ticker);
      revokeUrls();
    },
  };
}
