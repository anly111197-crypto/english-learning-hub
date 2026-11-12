// A small colored cell: skill letter + band. Color comes from data-level (tokens.css --band-*).
import { bandLevel, formatBand } from "../services/bands.js";

export function bandCell({ letter, band, marked = false }) {
  const el = document.createElement("span");
  el.className = "band-cell nowrap";
  el.dataset.level = bandLevel(band);
  const l = document.createElement("span");
  l.className = "band-cell-letter";
  l.textContent = letter;
  const v = document.createElement("span");
  v.className = "band-cell-value";
  v.textContent = band === null || band === undefined ? "–" : formatBand(band) + (marked ? "*" : "");
  el.append(l, v);
  return el;
}
