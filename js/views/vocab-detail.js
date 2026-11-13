// Content of the word panel: editable fields, contexts, where it appeared, Leitner info.
import { h, autoGrow, formatDateVi } from "../components/dom.js";
import { speakButton } from "../components/speech.js";
import { POS_OPTIONS, sourceLabel } from "../services/taxonomy.js";
import { splitLines, splitList } from "../services/vocab-ops.js";
import { notesBlock } from "../components/notes-block.js";

const field = (label, el, id, hint) => h("div", { class: "field" },
  h("label", { class: "field-label", for: id }, label), el, hint ? h("p", { class: "form-hint" }, hint) : null);

// Groups occurrences by test: "Cam 15 · Test 1" -> { href, count }.
function appearances(occurrences) {
  const groups = new Map();
  for (const o of occurrences) {
    const s = o.source;
    const key = s?.book && s?.test ? `${s.book}-${s.test}` : "none";
    const g = groups.get(key) ?? { key, book: s?.book, test: s?.test, count: 0 };
    g.count++;
    groups.set(key, g);
  }
  return [...groups.values()];
}

// ctx: { word, occurrences, topics, notes, notebooks }
// on:  { save(fields) -> { conflict? }, merge(conflictId), remove() }
export function buildVocabDetail({ word, occurrences, topics, notes = [], notebooks = [] }, on) {
  const inputs = {
    word: h("input", { id: "vd-word", class: "input", type: "text", value: word.word ?? "", autocomplete: "off" }),
    lemma: h("input", { id: "vd-lemma", class: "input", type: "text", value: word.lemma ?? "", autocomplete: "off", autocapitalize: "none" }),
    pos: h("select", { id: "vd-pos", class: "input" },
      POS_OPTIONS.map((p) => h("option", { value: p.value, selected: p.value === (word.pos ?? "") ? true : null }, p.label))),
    ipa: h("input", { id: "vd-ipa", class: "input", type: "text", value: word.ipa ?? "", placeholder: "/ˈmɪtɪɡeɪt/", autocomplete: "off" }),
    meaningVi: h("input", { id: "vd-meaning", class: "input", type: "text", value: word.meaningVi ?? "", placeholder: "Nghĩa tiếng Việt", autocomplete: "off" }),
    definitionEn: h("textarea", { id: "vd-def", class: "input textarea", rows: "2", placeholder: "English definition" }, word.definitionEn ?? ""),
    topic: h("input", { id: "vd-topic", class: "input", type: "text", value: word.topic ?? "", list: "vd-topics", autocomplete: "off", placeholder: "ví dụ: environment" }),
    collocations: h("textarea", { id: "vd-coll", class: "input textarea", rows: "2", placeholder: "Mỗi dòng một cụm" }, (word.collocations ?? []).join("\n")),
    synonyms: h("input", { id: "vd-syn", class: "input", type: "text", value: (word.synonyms ?? []).join(", "), placeholder: "cách nhau bằng dấu phẩy", autocomplete: "off" }),
  };
  autoGrow(inputs.definitionEn);
  autoGrow(inputs.collocations);

  const message = h("p", { class: "form-error", role: "alert", hidden: true });
  const conflictBox = h("div", { class: "conflict", hidden: true });

  const read = () => ({
    word: inputs.word.value, lemma: inputs.lemma.value, pos: inputs.pos.value, ipa: inputs.ipa.value,
    meaningVi: inputs.meaningVi.value, definitionEn: inputs.definitionEn.value, topic: inputs.topic.value,
    collocations: splitLines(inputs.collocations.value), synonyms: splitList(inputs.synonyms.value),
  });

  async function submit(e) {
    e.preventDefault();
    message.hidden = true;
    conflictBox.hidden = true;
    try {
      const res = await on.save(read());
      if (res?.conflict) {
        const c = res.conflict;
        conflictBox.replaceChildren(
          h("p", {}, `Từ "${c.word}" (${c.pos || "chưa rõ loại từ"}) đã có trong kho. Không ghi đè. Bạn có thể gộp thẻ này vào thẻ đó.`),
          h("button", { type: "button", class: "btn btn-outline", onClick: () => on.merge(c.id) }, "Gộp vào thẻ đó"));
        conflictBox.hidden = false;
      }
    } catch (err) {
      message.textContent = err.message || "Không lưu được.";
      message.hidden = false;
    }
  }

  const form = h("form", { class: "form", novalidate: true, onSubmit: submit },
    h("datalist", { id: "vd-topics" }, topics.map((t) => h("option", { value: t }))),
    field("Từ", inputs.word, "vd-word"),
    h("div", { class: "field-row" },
      field("Dạng gốc (lemma)", inputs.lemma, "vd-lemma", "Dùng để nhận ra từ trùng."),
      field("Loại từ", inputs.pos, "vd-pos")),
    h("div", { class: "field-row" },
      field("IPA", inputs.ipa, "vd-ipa"),
      field("Chủ đề", inputs.topic, "vd-topic")),
    field("Nghĩa tiếng Việt", inputs.meaningVi, "vd-meaning"),
    field("Định nghĩa tiếng Anh", inputs.definitionEn, "vd-def"),
    field("Collocations", inputs.collocations, "vd-coll"),
    field("Từ đồng nghĩa", inputs.synonyms, "vd-syn"),
    // Written by Claude (step 8a), shown for reading only. Never used as a context sentence in the warm-up.
    word.exampleEn || (word.wordFamily ?? []).length ? h("div", { class: "claude-extra", dataset: { role: "claude-extra" } },
      word.exampleEn ? h("p", {}, h("strong", {}, "Ví dụ của Claude: "), word.exampleEn) : null,
      (word.wordFamily ?? []).length ? h("p", {}, h("strong", {}, "Họ từ: "), word.wordFamily.join(", ")) : null) : null,
    message, conflictBox,
    h("div", { class: "detail-actions" },
      h("button", { type: "submit", class: "btn btn-primary" }, "Lưu thay đổi"),
      h("button", { type: "button", class: "btn btn-danger", onClick: on.remove }, "Xoá từ")));

  const contexts = (word.contexts ?? []).length
    ? h("ul", { class: "context-list" }, word.contexts.map((c) => h("li", { class: "context-item" },
      h("p", { class: "context-sentence" }, c.sentence),
      h("p", { class: "context-source" }, sourceLabel(c.source), c.date ? ` · ${formatDateVi(c.date)}` : ""))))
    : h("p", { class: "muted" }, "Chưa có ngữ cảnh.");

  const where = appearances(occurrences);
  const appears = where.length
    ? h("ul", { class: "appear-list" }, where.map((g) => h("li", {},
      g.book ? h("a", { class: "link", href: `#/practice/${g.book}/${g.test}` }, `Cam ${g.book} · Test ${g.test}`) : h("span", {}, "Không gắn test"),
      h("span", { class: "muted nowrap" }, ` · ${g.count} lần`))))
    : h("p", { class: "muted" }, "Chưa có.");

  const node = h("div", { class: "detail vocab-detail" },
    speakButton(word.word, { withLabel: true, className: "btn btn-outline btn-sm" }),
    form,
    h("h3", { class: "section-label" }, "Ngữ cảnh đã ghi"), contexts,
    h("h3", { class: "section-label" }, "Xuất hiện trong"), appears,
    notesBlock(notes, notebooks),
    h("h3", { class: "section-label" }, "Ôn tập (Leitner)"),
    h("p", {}, `Hộp ${word.box} / 5 · ôn lần tới: `, h("strong", { class: "nowrap" }, word.nextReview ? formatDateVi(word.nextReview) : "chưa có")),
    h("p", { class: "muted" }, `Ôn lần gần nhất: ${word.lastReviewedAt ? formatDateVi(word.lastReviewedAt) : "chưa có"} · Số lần quên: ${word.lapses ?? 0}`));

  return { title: word.word, badge: `Hộp ${word.box}`, node };
}
