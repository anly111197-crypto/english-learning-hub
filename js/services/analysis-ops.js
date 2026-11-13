// Database side of Writing & Speaking AI (step 8b). Views call this, not repo.js directly.
import { list, get, put } from "./repo.js";
import { normalizeText, unionStrings } from "./dedupe.js";
import { isoDate, addDays } from "./leitner.js";
import { statusAfterRecurrence } from "./errors.js";
import { findAttempt, saveAttempt } from "./practice-store.js";
import { countWords } from "./practice-run.js";
import { cleanSource } from "./capture.js";
import { findExistingError, findExistingVocab, errorKey, vocabKey, bandsRecord, overallInfo } from "./analysis.js";

export async function loadStudioData() {
  const [errors, vocab, occurrences, submissions] = await Promise.all([list("errors"), list("vocab"), list("occurrences"), list("submissions")]);
  return { errors, vocab, occurrences, submissions };
}

// What the typed text is saved as. Pieces typed on this screen are marked origin "studio" so that the screen can list
// them; pieces from the practice screen keep their own record (doneAt etc.).
export async function saveStudioDraft({ id = null, kind, source, taskType = "", prompt = "", text = "" }) {
  const old = id ? await get("submissions", id) : null;
  const rec = {
    ...(old ?? {}),
    kind, source, taskType, prompt, text, wordCount: countWords(text),
    durationSec: old?.durationSec ?? 0, status: old?.status ?? "draft", origin: old?.origin ?? "studio",
  };
  if (id) rec.id = id;
  return put("submissions", rec);
}

// Does saving this band change a band that is already there? { skill, task, existing } or null when there is no test to
// write to. `existing` is the attempt that would be overwritten (or null).
export async function planBand(sub) {
  const src = sub.source ?? {};
  if (!src.book || !src.test) return null;
  const skill = sub.kind === "speaking" ? "S" : "W";
  const task = skill === "W" ? (src.task ?? 2) : null;
  return { book: src.book, test: src.test, skill, task, existing: await findAttempt(src.book, src.test, skill, task) };
}

// ---- Saving the ticked rows ----

const blank = (v) => !String(v ?? "").trim();

// sourceFor: { book, test, skill: "W" | "S", part } for the occurrence records.
async function saveErrorRow(item, sub, source) {
  const today = isoDate();
  const all = await list("errors");
  const existing = findExistingError(all, item);
  let saved;
  if (existing) {
    // Same rule again: one more occurrence (spec 6.5). A fixed error written again becomes "recurring" (6.4).
    const pending = String(existing.signature ?? "").startsWith("pending:");
    saved = await put("errors", {
      ...existing,
      occurrences: (Number(existing.occurrences) || 1) + 1,
      lastSeen: today,
      status: statusAfterRecurrence(existing.status),
      warmupStreak: existing.status === "fixed" ? 0 : existing.warmupStreak ?? 0,
      type: existing.type || item.type,
      corrected: blank(existing.corrected) ? item.corrected : existing.corrected,
      explanationVi: blank(existing.explanationVi) ? item.explanationVi : existing.explanationVi,
      correctExample: blank(existing.correctExample) ? item.correctExample : existing.correctExample,
      ...(pending ? { signature: item.signature } : {}),
      enriched: true,
    });
  } else {
    saved = await put("errors", {
      original: item.original, corrected: item.corrected, type: item.type, signature: item.signature,
      explanationVi: item.explanationVi, correctExample: item.correctExample,
      occurrences: 1, firstSeen: today, lastSeen: today, status: "new", warmupStreak: 0, enriched: true,
    });
  }
  await put("occurrences", { itemType: "error", itemId: saved.id, source, submissionId: sub.id, sentence: item.original, date: today });
  return { merged: Boolean(existing) };
}

// The word is a suggestion, not something the learner wrote: Claude's example goes to exampleEn and never to
// contexts[] (the warm-up only uses sentences the learner wrote). An old card keeps its box, review date and lapses.
async function saveVocabRow(item, sub, source) {
  const today = isoDate();
  const all = await list("vocab");
  const existing = findExistingVocab(all, item.lemma, item.pos);
  let saved;
  if (existing) {
    saved = await put("vocab", {
      ...existing,
      pos: blank(existing.pos) ? item.pos : existing.pos,
      ipa: blank(existing.ipa) ? item.ipa : existing.ipa,
      meaningVi: blank(existing.meaningVi) ? item.meaningVi : existing.meaningVi,
      collocations: unionStrings(existing.collocations, item.collocations),
      exampleEn: blank(existing.exampleEn) ? item.example : existing.exampleEn,
      enriched: true,
    });
  } else {
    saved = await put("vocab", {
      word: item.word, lemma: normalizeText(item.lemma), pos: item.pos, ipa: item.ipa, meaningVi: item.meaningVi,
      definitionEn: "", topic: "", collocations: item.collocations, synonyms: [], wordFamily: [],
      contexts: [], exampleEn: item.example, box: 1, nextReview: addDays(today, 1), lapses: 0, lastReviewedAt: null, enriched: true,
    });
  }
  await put("occurrences", { itemType: "vocab", itemId: saved.id, source, submissionId: sub.id, sentence: "", date: today });
  return { merged: Boolean(existing) };
}

// sub: the stored submission (it must exist: the caller creates it from the typed text first).
// result: the cleaned analysis. errors / vocab: the tray rows that are ticked. writeBand: also write the band to the matrix.
// Returns { errors, vocab, mergedErrors, mergedVocab, band }.
export async function saveAnalysis({ sub, result, errors, vocab, writeBand }) {
  const src = sub.source ?? {};
  const source = cleanSource(src.book ? { book: src.book, test: src.test, skill: sub.kind === "speaking" ? "S" : "W", part: sub.kind === "speaking" ? src.part : src.task } : null);
  const out = { errors: 0, vocab: 0, mergedErrors: 0, mergedVocab: 0, band: null };

  for (const row of errors) {
    const res = await saveErrorRow(row.item, sub, source);
    out.errors += 1;
    if (res.merged) out.mergedErrors += 1;
  }
  for (const row of vocab) {
    const res = await saveVocabRow(row.item, sub, source);
    out.vocab += 1;
    if (res.merged) out.mergedVocab += 1;
  }

  const old = (await get("submissions", sub.id)) ?? sub;
  const savedKeys = {
    errors: unionStrings(old.saved?.errors ?? [], errors.map((r) => errorKey(r.item))),
    vocab: unionStrings(old.saved?.vocab ?? [], vocab.map((r) => vocabKey(r.item))),
  };
  const stored = await put("submissions", {
    ...old, status: "analyzed", result, bands: bandsRecord(result), aiMode: "manual", analyzedAt: new Date().toISOString(), saved: savedKeys,
  });

  if (writeBand) {
    const plan = await planBand(stored);
    if (plan) {
      const { computed } = overallInfo(result);
      await saveAttempt({
        book: plan.book, test: plan.test, skill: plan.skill, task: plan.task, band: computed, date: isoDate(),
        durationMin: plan.existing?.durationMin ?? (stored.durationSec ? Math.max(1, Math.round(stored.durationSec / 60)) : null),
        note: plan.existing?.note ?? "", submissionId: stored.id,
      });
      out.band = computed;
    }
  }
  return out;
}
