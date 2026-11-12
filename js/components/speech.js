// Pronunciation with the browser's own speech synthesis (British English). No audio files, no network.
export const canSpeak = () => "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

export function speak(text) {
  if (!canSpeak() || !text) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-GB";
  const voice = synth.getVoices().find((v) => v.lang === "en-GB" || v.lang === "en_GB");
  if (voice) utterance.voice = voice;
  synth.speak(utterance);
}

// A button that reads `text` aloud. Returns null when the browser has no speech synthesis.
// withLabel: show the word "Nghe" next to the icon.
export function speakButton(text, { withLabel = false, className = "icon-btn" } = {}) {
  if (!canSpeak()) return null;
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.setAttribute("aria-label", `Nghe phát âm ${text}`);
  b.title = "Nghe";
  b.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-volume"/></svg>';
  if (withLabel) {
    const span = document.createElement("span");
    span.textContent = "Nghe";
    b.append(span);
  }
  b.addEventListener("click", (e) => { e.stopPropagation(); speak(text); });
  return b;
}
