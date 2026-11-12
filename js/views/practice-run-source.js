// The "Đề" side of the practice screen (spec 5.9): the exam PDF and the audio, from files on this computer or from the
// Drive link saved in step 3. Files are read only through URL.createObjectURL: they are never stored (not in IndexedDB,
// not in localStorage, not in the service worker cache) and never sent anywhere. Only their NAMES are remembered.
import { h } from "../components/dom.js";
import { showToast } from "../components/toast.js";
import { isHttpsUrl } from "../services/practice-store.js";
import {
  classifyFiles, trackLabel, driveFileId, drivePreviewUrl, filesKey, loadFileNames, saveFileNames,
} from "../services/practice-run.js";

const SEEK_SECONDS = 5;

// opts: { book, test, skill, testRec, storage, onPlay?() }  onPlay runs every time the audio starts playing
export function createSource({ book, test, skill, testRec, storage, onPlay = null }) {
  const pdfLink = isHttpsUrl(testRec?.pdfUrl) ? testRec.pdfUrl : null;
  const driveId = pdfLink ? driveFileId(pdfLink) : null;
  const wantsAudio = skill === "L";

  const s = {
    mode: "file", // "file" | "drive"
    pdf: null, // { url, name }
    tracks: [], // [{ url, name }] in natural name order
    track: 0,
  };

  const revokeAll = () => {
    if (s.pdf) URL.revokeObjectURL(s.pdf.url);
    for (const t of s.tracks) URL.revokeObjectURL(t.url);
    s.pdf = null;
    s.tracks = [];
  };

  // ---- pieces that are rebuilt ----
  const body = h("div", { class: "source-body" });
  const audioBar = h("div", { class: "run-audio", hidden: true });
  let audioEl = null;
  let playBtn = null;

  const input = h("input", {
    type: "file", hidden: true, multiple: true,
    accept: ".pdf,application/pdf,audio/*,.mp3,.m4a,.wav,.ogg,.aac",
    onChange: () => { pick(input.files); input.value = ""; },
  });

  const modeButtons = [["file", "File trên máy"], ["drive", "Link Drive đã lưu"]].map(([id, label]) => h("button", {
    type: "button", class: "seg-btn", dataset: { mode: id }, onClick: () => setMode(id),
  }, label));
  const modeBar = h("div", { class: "seg source-modes", role: "group", "aria-label": "Nguồn đề" }, modeButtons);

  function setMode(mode) {
    s.mode = mode;
    renderBody();
  }

  function pick(fileList) {
    const { pdf, audio, ignored } = classifyFiles(fileList);
    if (!pdf && audio.length === 0) {
      showToast("Chỉ nhận file PDF và file audio (mp3, m4a, wav…).", "error");
      return;
    }
    if (ignored.length) showToast(`Bỏ qua ${ignored.length} file không phải PDF hoặc audio.`, "error");
    if (pdf) {
      if (s.pdf) URL.revokeObjectURL(s.pdf.url);
      s.pdf = { url: URL.createObjectURL(pdf), name: pdf.name };
    }
    if (audio.length) {
      for (const t of s.tracks) URL.revokeObjectURL(t.url);
      s.tracks = audio.map((f) => ({ url: URL.createObjectURL(f), name: f.name }));
      s.track = 0;
    }
    saveFileNames(storage, filesKey(book, test), { pdf: s.pdf?.name ?? "", audio: s.tracks.map((t) => t.name) });
    s.mode = "file";
    renderBody();
    renderAudio();
  }

  const openNewTab = (href) => h("a", {
    class: `btn btn-outline${href ? "" : " is-disabled"}`, dataset: { role: "open-pdf" },
    ...(href ? { href, target: "_blank", rel: "noopener noreferrer" } : { "aria-disabled": "true" }),
  }, "Mở PDF trong tab mới");

  const chooseButton = (label = "Chọn file trên máy") => h("button", { type: "button", class: "btn btn-primary", dataset: { role: "choose" }, onClick: () => input.click() }, label);

  function renderFileMode() {
    const remembered = loadFileNames(storage, filesKey(book, test));
    const hint = [];
    if (remembered && !s.pdf && s.tracks.length === 0) {
      const names = [remembered.pdf, ...remembered.audio].filter(Boolean).join(", ");
      hint.push(h("p", { class: "source-hint", dataset: { role: "remembered" } }, `Lần trước bạn chọn: ${names}. Chọn lại các file đó (trình duyệt không giữ file sau khi tải lại trang).`));
    }
    return [
      h("div", { class: "source-actions" },
        chooseButton(s.pdf || s.tracks.length ? "Chọn file khác" : "Chọn file trên máy"),
        openNewTab(s.pdf?.url ?? null)),
      h("p", { class: "source-hint" }, wantsAudio
        ? "Chọn file PDF của đề và các file audio Part 1–4 cùng lúc. File chỉ được đọc trong phiên này, không lưu và không gửi đi đâu."
        : "Chọn file PDF của đề. File chỉ được đọc trong phiên này, không lưu và không gửi đi đâu."),
      ...hint,
      s.pdf
        ? h("iframe", { class: "run-pdf", src: s.pdf.url, title: `Đề: ${s.pdf.name}` })
        : h("div", { class: "source-empty" }, h("p", {}, "Chưa chọn đề PDF.")),
    ];
  }

  function renderDriveMode() {
    const audioLinks = (testRec?.audioUrls ?? []).map((u, i) => (isHttpsUrl(u) ? { part: i + 1, url: u } : null)).filter(Boolean);
    const links = audioLinks.length
      ? h("div", { class: "link-buttons" }, audioLinks.map((a) => h("a", { class: "btn btn-outline", href: a.url, target: "_blank", rel: "noopener noreferrer" }, `Mở audio Part ${a.part}`)))
      : null;
    const switchBtn = h("button", { type: "button", class: "btn btn-outline", onClick: () => setMode("file") }, "Chọn file trên máy");

    if (!pdfLink) {
      return [
        h("div", { class: "source-actions" }, openNewTab(null)),
        h("div", { class: "source-empty" },
          h("p", {}, "Test này chưa có link đề PDF. Thêm link ở panel test (Sửa link), hoặc chọn file trên máy."), switchBtn),
        links,
      ];
    }
    if (!driveId) {
      return [
        h("div", { class: "source-actions" }, openNewTab(pdfLink)),
        h("div", { class: "source-empty" },
          h("p", {}, "Link đã lưu không phải link file Google Drive nên không nhúng được. Mở trong tab mới, hoặc chọn file trên máy."), switchBtn),
        links,
      ];
    }
    return [
      h("div", { class: "source-actions" }, openNewTab(pdfLink), switchBtn),
      h("p", { class: "source-hint", dataset: { role: "drive-note" } },
        "Khung xem của Drive. Nếu khung trống hoặc báo lỗi (Safari có thể chặn), bấm \"Chọn file trên máy\" để dùng file PDF đã tải về."),
      h("iframe", { class: "run-pdf", src: drivePreviewUrl(driveId), title: "Đề PDF (Google Drive)", referrerpolicy: "no-referrer" }),
      wantsAudio ? h("p", { class: "source-hint" }, "Audio chỉ phát trong trang khi chọn file trên máy. Với link Drive, mở từng Part ở tab mới:") : null,
      wantsAudio ? links : null,
    ];
  }

  function renderBody() {
    for (const b of modeButtons) b.setAttribute("aria-pressed", String(b.dataset.mode === s.mode));
    body.replaceChildren(...(s.mode === "file" ? renderFileMode() : renderDriveMode()).filter(Boolean));
  }

  // ---- audio ----
  function renderAudio() {
    if (!wantsAudio || s.tracks.length === 0) {
      audioEl?.pause();
      audioEl = null;
      audioBar.hidden = true;
      audioBar.replaceChildren();
      return;
    }
    const cur = s.tracks[s.track];
    audioEl = h("audio", { class: "run-audio-el", controls: true, preload: "metadata", src: cur.url, "aria-label": "Audio" });
    audioEl.addEventListener("play", () => { syncPlay(); onPlay?.(); });
    audioEl.addEventListener("pause", syncPlay);
    audioEl.addEventListener("ended", syncPlay);

    const picker = s.tracks.length > 1
      ? h("select", {
        class: "input run-track", "aria-label": "Chọn audio", onChange: (e) => { s.track = Number(e.target.value); renderAudio(); },
      }, s.tracks.map((t, i) => h("option", { value: String(i), selected: i === s.track }, trackLabel(i, s.tracks.length, t.name))))
      : h("span", { class: "run-track-name" }, trackLabel(0, 1, cur.name));

    playBtn = h("button", { type: "button", class: "btn btn-primary", dataset: { role: "play" }, onClick: toggle }, "Phát");
    audioBar.hidden = false;
    audioBar.replaceChildren(
      picker,
      h("div", { class: "run-audio-btns" },
        h("button", { type: "button", class: "btn btn-outline", dataset: { role: "back" }, "aria-label": "Tua lại 5 giây", onClick: () => seek(-SEEK_SECONDS) }, "−5s"),
        playBtn,
        h("button", { type: "button", class: "btn btn-outline", dataset: { role: "fwd" }, "aria-label": "Tua tới 5 giây", onClick: () => seek(SEEK_SECONDS) }, "+5s")),
      audioEl,
      h("span", { class: "run-audio-keys muted" }, "Space: phát/dừng · ←/→: tua 5s"));
    syncPlay();
  }

  function syncPlay() {
    if (playBtn && audioEl) playBtn.textContent = audioEl.paused ? "Phát" : "Tạm dừng";
  }

  function toggle() {
    if (!audioEl) return;
    if (audioEl.paused) audioEl.play().catch(() => showToast("Trình duyệt không phát được file này.", "error"));
    else audioEl.pause();
  }

  function seek(delta) {
    if (!audioEl) return;
    const dur = Number.isFinite(audioEl.duration) ? audioEl.duration : Infinity;
    audioEl.currentTime = Math.min(dur, Math.max(0, audioEl.currentTime + delta));
  }

  // ---- start ----
  const pane = h("div", { class: "source-pane" }, modeBar, body, input);
  renderBody();

  return {
    pane,
    audioBar,
    hasAudio: () => audioEl !== null,
    isAudioElement: (el) => audioEl !== null && audioEl === el,
    toggle,
    seek,
    destroy() {
      audioEl?.pause();
      revokeAll();
    },
  };
}
