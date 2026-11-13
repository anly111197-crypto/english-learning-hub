// Pure: fields of the kept vocabulary card after folding `drop` into `keep` (spec 6.5). No IndexedDB.
import { unionStrings, addContext } from "./dedupe.js";

// Contexts, collocations, synonyms and word family are joined; empty fields are filled from the dropped card.
// Learning progress (box, nextReview, lapses):
//   default        the lower box and the earlier review date win (the learner knows it less well): "Gộp" in the bank
//   keepProgress   the kept card's progress is left exactly as it is (a freshly enriched card folds into an old one)
export function mergeVocabFields(keep, drop, { keepProgress = false } = {}) {
  let contexts = keep.contexts ?? [];
  for (const c of drop.contexts ?? []) contexts = addContext(contexts, c).contexts;
  const first = (a, b) => (a ? a : b ?? "");
  const progress = keepProgress
    ? {}
    : {
        box: Math.min(keep.box ?? 1, drop.box ?? 1),
        nextReview: [keep.nextReview, drop.nextReview].filter(Boolean).sort()[0] ?? keep.nextReview,
        lapses: (keep.lapses ?? 0) + (drop.lapses ?? 0),
      };
  return {
    ...keep,
    contexts,
    collocations: unionStrings(keep.collocations, drop.collocations),
    synonyms: unionStrings(keep.synonyms, drop.synonyms),
    wordFamily: unionStrings(keep.wordFamily, drop.wordFamily),
    ipa: first(keep.ipa, drop.ipa),
    meaningVi: first(keep.meaningVi, drop.meaningVi),
    definitionEn: first(keep.definitionEn, drop.definitionEn),
    exampleEn: first(keep.exampleEn, drop.exampleEn),
    topic: first(keep.topic, drop.topic),
    ...progress,
    enriched: Boolean(keep.enriched && drop.enriched),
  };
}
