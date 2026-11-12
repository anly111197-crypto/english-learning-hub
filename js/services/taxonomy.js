// Fixed lists used by forms and labels. Pure data.

// The 10 error groups (spec 6.7). `slug` is what is stored in errors.type.
export const ERROR_TYPES = [
  { slug: "tenses", label: "Tenses" },
  { slug: "articles", label: "Articles" },
  { slug: "prepositions", label: "Prepositions" },
  { slug: "subject-verb-agreement", label: "Subject-Verb Agreement" },
  { slug: "passive-voice", label: "Passive Voice" },
  { slug: "word-forms", label: "Word Forms" },
  { slug: "sentence-structure", label: "Sentence Structure" },
  { slug: "collocations", label: "Collocations" },
  { slug: "plurals-countability", label: "Plurals & Countability" },
  { slug: "punctuation-spelling", label: "Punctuation & Spelling" },
];

export const errorTypeLabel = (slug) => ERROR_TYPES.find((t) => t.slug === slug)?.label ?? "Chưa rõ nhóm";

export const SKILL_LABELS = { L: "Listening", R: "Reading", W: "Writing", S: "Speaking" };

// What "part" means for each skill.
export const PART_OPTIONS = {
  L: [1, 2, 3, 4].map((n) => ({ value: n, label: `Part ${n}` })),
  R: [1, 2, 3].map((n) => ({ value: n, label: `Passage ${n}` })),
  W: [1, 2].map((n) => ({ value: n, label: `Task ${n}` })),
  S: [1, 2, 3].map((n) => ({ value: n, label: `Part ${n}` })),
};

export const POS_OPTIONS = [
  { value: "", label: "Chưa rõ" },
  { value: "noun", label: "noun" },
  { value: "verb", label: "verb" },
  { value: "adjective", label: "adjective" },
  { value: "adverb", label: "adverb" },
  { value: "phrase", label: "phrase" },
  { value: "other", label: "other" },
];

export function partLabel(skill, part) {
  return PART_OPTIONS[skill]?.find((p) => p.value === Number(part))?.label ?? "";
}

// source = { book, test, skill, part } or null.  long: "Cam 15 · Test 1 · Reading Passage 2"
export function sourceLabel(source, { short = false } = {}) {
  if (!source || !source.book) return "Không gắn test";
  const skill = source.skill ? (short ? source.skill : SKILL_LABELS[source.skill]) : "";
  const part = source.skill && source.part ? partLabel(source.skill, source.part) : "";
  if (short) {
    const p = part ? ` ${part.replace(/^\D+/, "")}` : "";
    return `Cam ${source.book} · T${source.test}${skill ? ` · ${skill}${p}` : ""}`;
  }
  return `Cam ${source.book} · Test ${source.test}${skill ? ` · ${skill}${part ? " " + part : ""}` : ""}`;
}
