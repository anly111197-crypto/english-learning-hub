// What the learner sees in the warm-up: the 4 kinds of vocabulary exercise, the grammar step, the empty
// messages and the summary. Only data the learner wrote is shown (no scores, no invented sources).
// Every renderer returns { node, onKey(e), refreshNext() }.
import { h, icon } from "../components/dom.js";
import { speakButton } from "../components/speech.js";
import { diffWords } from "../services/diff.js";
import { sourceLabel } from "../services/taxonomy.js";
import { gradeAnswer } from "../services/leitner.js";

const kbd = (t) => h("kbd", { class: "kbd" }, t);
const OUTCOME_ICON = { correct: "i-check-circle", near: "i-minus-circle", wrong: "i-x-circle" };
const letters = ["A", "B", "C", "D"];

const sourceChip = (source) => (source?.book ? h("span", { class: "chip nowrap" }, sourceLabel(source)) : null);
const posChip = (pos) => (pos ? h("span", { class: "chip nowrap" }, pos) : null);

function tokens(list, cls) {
  const out = [];
  list.forEach((t, i) => {
    if (i > 0) out.push(" ");
    out.push(t.changed ? h("span", { class: cls }, t.text) : t.text);
  });
  return out;
}

// "before [word] after" with the word highlighted.
const highlighted = (before, match, after) => [before, h("mark", { class: "wu-mark" }, match), after];

function explainBox(q) {
  const rows = [];
  if (q.meaningVi) rows.push(h("p", {}, h("strong", {}, "Nghĩa: "), q.meaningVi));
  if (q.ipa) rows.push(h("p", { class: "muted" }, q.ipa));
  if (q.synonyms.length) rows.push(h("p", {}, h("strong", {}, "Đồng nghĩa: "), q.synonyms.join(", ")));
  if (q.collocations.length) {
    rows.push(h("p", { class: "wu-chip-row" }, h("strong", {}, "Collocation: "),
      q.collocations.map((c) => h("span", { class: "wu-colloc" }, c))));
  }
  return rows.length ? h("div", { class: "wu-explain" }, rows) : null;
}

function feedbackNode(outcome, message) {
  return h("p", { class: "wu-feedback", role: "status", dataset: { outcome } }, icon(OUTCOME_ICON[outcome], "wu-fb-icon"), h("span", {}, message));
}

// The line + "next" button shown after a question is finished.
function footerAfter(hooks, outcome, message) {
  const btn = h("button", { type: "button", class: "btn btn-primary wu-next", onClick: () => hooks.next() }, `${hooks.nextLabel()} `, kbd("Enter"));
  const node = h("div", { class: "wu-after" }, feedbackNode(outcome, message), btn);
  return { node, refresh: () => { btn.firstChild.textContent = `${hooks.nextLabel()} `; } };
}

const card = (...children) => h("section", { class: "wu-card" }, ...children);
const tag = (text) => h("p", { class: "wu-tag" }, text);

// ---- 1. Flashcard (boxes 1-2, and every card that has no meaning) ----
function flashcard(q, hooks) {
  let flipped = false;
  let done = false;
  let after = null;

  const back = h("div", { class: "wu-back", hidden: true });
  if (q.hasMeaning) back.append(h("p", { class: "wu-meaning" }, q.meaningVi));
  else back.append(h("p", { class: "muted" }, "Từ này chưa có nghĩa. Hãy nhớ lại qua câu bạn đã ghi rồi tự đánh giá."));
  if (q.context) {
    back.append(h("blockquote", { class: "wu-context" }, `“${q.context.sentence}”`,
      q.context.source?.book ? h("footer", { class: "muted" }, sourceLabel(q.context.source)) : null));
  }
  if (q.collocations.length) back.append(h("p", { class: "wu-chip-row" }, q.collocations.map((c) => h("span", { class: "wu-colloc" }, c))));
  if (q.synonyms.length) back.append(h("p", {}, h("strong", {}, "Đồng nghĩa: "), q.synonyms.join(", ")));

  const rate = async (rating) => {
    if (!flipped || done) return;
    done = true;
    for (const b of buttons) b.disabled = true;
    const outcome = gradeAnswer(q, rating);
    const res = await hooks.commit(outcome);
    after = footerAfter(hooks, outcome, res.message);
    node.append(after.node);
    after.node.querySelector(".wu-next")?.focus();
  };
  const mk = (rating, label, key, extra = "") => h("button", { type: "button", class: `btn wu-rate wu-rate-${rating}`, disabled: true, onClick: () => rate(rating) }, label, " ", kbd(key), extra);
  const buttons = [mk("forgot", "Quên", "1"), mk("vague", "Nhớ mơ hồ", "2"), mk("good", "Nhớ rõ", "3 / Space")];

  const flip = () => {
    if (flipped) return;
    flipped = true;
    back.hidden = false;
    flipBtn.hidden = true;
    for (const b of buttons) b.disabled = false;
  };
  const flipBtn = h("button", { type: "button", class: "btn btn-outline", onClick: flip }, "Lật thẻ ", kbd("Space"));

  const node = card(
    tag("Dạng bài: flashcard tự đánh giá"),
    h("div", { class: "wu-head" },
      h("h2", { class: "wu-word" }, q.word),
      speakButton(q.word),
      posChip(q.pos),
      q.context ? sourceChip(q.context.source) : null),
    q.ipa ? h("p", { class: "muted wu-ipa" }, q.ipa) : null,
    h("p", { class: "wu-prompt" }, q.hasMeaning ? "Bạn còn nhớ nghĩa của từ này không?" : "Bạn còn nhớ từ này không?"),
    flipBtn, back,
    h("div", { class: "wu-rates" }, buttons));

  return {
    node,
    refreshNext: () => after?.refresh(),
    onKey(e) {
      if (done) {
        if (e.key === "Enter" || e.key === " ") { hooks.next(); return true; }
        return false;
      }
      if (e.key === " " || e.key === "Enter") {
        if (!flipped) flip();
        else if (e.key === " ") rate("good");
        return true;
      }
      if (flipped && e.key === "1") { rate("forgot"); return true; }
      if (flipped && e.key === "2") { rate("vague"); return true; }
      if (flipped && e.key === "3") { rate("good"); return true; }
      return false;
    },
  };
}

// ---- 2. Choose the meaning (box 3) ----
function choice(q, hooks) {
  let done = false;
  let after = null;
  const buttons = q.options.map((o, i) => h("button", { type: "button", class: "wu-option", dataset: { index: i }, onClick: () => select(i) },
    h("span", { class: "wu-letter" }, letters[i]), h("span", { class: "wu-option-text" }, o.text), kbd(String(i + 1))));

  async function select(i) {
    if (done) return;
    done = true;
    const outcome = gradeAnswer(q, i);
    for (const b of buttons) b.disabled = true;
    buttons[q.correctIndex].classList.add("is-correct");
    if (outcome === "wrong") buttons[i].classList.add("is-wrong");
    const res = await hooks.commit(outcome);
    after = footerAfter(hooks, outcome, res.message);
    const box = explainBox(q);
    if (box) node.append(box);
    node.append(after.node);
    after.node.querySelector(".wu-next")?.focus();
  }

  const node = card(
    tag("Dạng bài: chọn nghĩa đúng trong ngữ cảnh"),
    h("div", { class: "wu-head" }, h("h2", { class: "wu-word" }, q.word), speakButton(q.word), posChip(q.pos), q.context ? sourceChip(q.context.source) : null),
    q.ipa ? h("p", { class: "muted wu-ipa" }, q.ipa) : null,
    q.context ? h("blockquote", { class: "wu-context" }, "“", highlighted(q.context.before, q.context.match, q.context.after), "”") : null,
    h("p", { class: "wu-prompt" }, q.context ? "Chọn nghĩa tiếng Việt phù hợp nhất của từ trong câu trên:" : "Chọn nghĩa tiếng Việt của từ:"),
    h("div", { class: "wu-options", role: "group", "aria-label": "Các đáp án" }, buttons));

  return {
    node,
    refreshNext: () => after?.refresh(),
    onKey(e) {
      if (done) {
        if (e.key === "Enter" || e.key === " ") { hooks.next(); return true; }
        return false;
      }
      const i = Number(e.key) - 1;
      if (i >= 0 && i < buttons.length) { select(i); return true; }
      return false;
    },
  };
}

// ---- 3 and 4. Typed answers: fill the blank (box 4) and type from a collocation (box 5) ----
// The hint shows the first letter and the length for free; "Gợi ý thêm chữ cái" shows one more letter each time.
function typed(q, hooks) {
  const isType = q.kind === "type";
  let done = false;
  let hintsUsed = 0;
  let after = null;

  const answer = q.match;
  const hintText = () => {
    const shown = Math.min(answer.length, 1 + hintsUsed);
    return [...answer].map((c, i) => (i < shown || c === " " ? c : "_")).join(" ");
  };
  const hint = h("span", { class: "wu-hint-letters" }, hintText());

  const input = h("input", {
    class: "input wu-input", type: "text", autocomplete: "off", autocapitalize: "none", spellcheck: "false", autofocus: true,
    "aria-label": isType ? "Từ bị che" : "Từ cần điền", placeholder: isType ? "Gõ từ bị che (hoặc cả cụm)" : "Gõ từ còn thiếu",
  });
  const blank = h("span", { class: "wu-blank" }, "________");
  const sentence = h("blockquote", { class: "wu-context" }, "“", q.before, blank, q.after, "”");

  async function finish(outcome) {
    if (done) return;
    done = true;
    input.readOnly = true;
    input.blur();
    for (const b of [checkBtn, hintBtn, giveUpBtn]) b.disabled = true;
    blank.replaceWith(h("mark", { class: "wu-mark" }, answer));
    const res = await hooks.commit(outcome, { hintsUsed });
    after = footerAfter(hooks, outcome, res.message);
    if (isType) {
      const others = q.collocations.filter((c) => c !== q.collocation);
      if (others.length) node.append(h("p", { class: "wu-chip-row" }, h("strong", {}, "Collocation khác: "), others.map((c) => h("span", { class: "wu-colloc" }, c))));
    }
    const box = explainBox({ ...q, collocations: isType ? [] : q.collocations });
    if (box) node.append(box);
    node.append(after.node);
    after.node.querySelector(".wu-next")?.focus();
  }

  const check = () => {
    if (done) return;
    if (!input.value.trim()) { input.focus(); return; }
    finish(gradeAnswer(q, input.value, { hintsUsed }));
  };
  const checkBtn = h("button", { type: "button", class: "btn btn-primary", onClick: check }, "Kiểm tra ", kbd("Enter"));
  const hintBtn = h("button", { type: "button", class: "btn btn-outline", onClick: () => { if (done) return; hintsUsed++; hint.textContent = hintText(); input.focus(); } }, "Gợi ý thêm chữ cái");
  const giveUpBtn = h("button", { type: "button", class: "btn btn-text", onClick: () => finish("wrong") }, "Tôi chưa nhớ từ này");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); e.stopPropagation(); check(); }
  });

  const node = card(
    tag(isType ? "Dạng bài: gõ từ bị che trong collocation" : "Dạng bài: điền từ vào chỗ trống"),
    h("div", { class: "wu-head" }, sourceChip(q.source), posChip(q.pos)),
    isType
      ? h("div", { class: "wu-meaning-box" }, h("p", { class: "wu-tag-small" }, "Nghĩa của từ bị che"), h("p", { class: "wu-meaning" }, q.meaningVi))
      : h("p", { class: "wu-prompt" }, "Điền từ thích hợp vào chỗ trống trong câu bạn đã ghi:"),
    sentence,
    h("p", { class: "wu-hint" }, !isType && q.meaningVi ? [`${q.pos ? `(${q.pos}) ` : ""}${q.meaningVi} · `] : null, "Gợi ý: ", hint),
    h("div", { class: "wu-input-row" }, input, checkBtn),
    h("div", { class: "wu-hint-row" }, hintBtn, giveUpBtn));

  return {
    node,
    focus: () => input.focus(),
    refreshNext: () => after?.refresh(),
    onKey(e) {
      if (done && (e.key === "Enter" || e.key === " ")) { hooks.next(); return true; }
      return false;
    },
  };
}

export function renderVocabQuestion(q, hooks) {
  const r = q.kind === "flashcard" ? flashcard(q, hooks) : q.kind === "choice" ? choice(q, hooks) : typed(q, hooks);
  return r;
}

// ---- Step 2: grammar ----
// q: { original, corrected, typeLabel, occurrences, explanationVi, correctExample }
export function renderErrorQuestion(q, hooks) {
  let revealed = false;
  let done = false;
  const d = diffWords(q.original, q.corrected);

  const answerBox = h("textarea", { class: "input textarea wu-answer", rows: "2", autofocus: true, placeholder: "Viết lại câu cho đúng" });
  const revealBtn = h("button", { type: "button", class: "btn btn-primary", onClick: () => reveal() }, "Xem đáp án ", kbd("Enter"));
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    answerBox.readOnly = true;
    answerBox.blur();
    revealBtn.hidden = true;
    const mine = answerBox.value.trim();
    node.append(h("div", { class: "wu-answer-reveal" },
      mine ? h("p", { class: "muted" }, h("strong", {}, "Câu bạn viết: "), mine) : null,
      h("p", { class: "wu-correct" }, icon("i-check-circle", "wu-fb-icon"), h("span", {}, tokens(d.right, "tok-ins"))),
      q.explanationVi ? h("p", {}, h("strong", {}, "Giải thích: "), q.explanationVi) : null,
      q.correctExample ? h("p", {}, h("strong", {}, "Ví dụ đúng: "), q.correctExample) : null,
      h("div", { class: "wu-self" },
        h("span", { class: "wu-self-label" }, "Tôi làm:"),
        h("button", { type: "button", class: "btn btn-outline wu-wrong", onClick: () => grade(false) }, "Sai / Cần xem lại ", kbd("1")),
        h("button", { type: "button", class: "btn btn-primary", onClick: () => grade(true) }, "Đúng ", kbd("2")))));
  };
  async function grade(correct) {
    if (!revealed || done) return;
    done = true;
    for (const b of node.querySelectorAll(".wu-self button")) b.disabled = true;
    await hooks.commit(correct);
    hooks.next();
  }
  answerBox.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.stopPropagation(); reveal(); }
  });

  const node = card(
    tag("Dạng bài: nhận diện và sửa lỗi ngữ pháp"),
    h("div", { class: "wu-head" }, h("span", { class: "chip nowrap" }, `${q.typeLabel} ×${q.occurrences}`)),
    h("div", { class: "wu-wrong-box" },
      h("p", { class: "wu-tag-small" }, "Câu có lỗi"),
      h("p", { class: "wu-wrong-sentence" }, icon("i-x-circle", "wu-fb-icon"), h("span", {}, tokens(d.wrong, "tok-del")))),
    h("label", { class: "field-label", for: "wu-rewrite" }, "Viết lại câu đúng"),
    answerBox, revealBtn);
  answerBox.id = "wu-rewrite";

  return {
    node,
    focus: () => answerBox.focus(),
    refreshNext: () => {},
    onKey(e) {
      if (!revealed) return false;
      if (e.key === "1") { grade(false); return true; }
      if (e.key === "2") { grade(true); return true; }
      return false;
    },
  };
}

// ---- Messages and summary ----
export function renderMessage({ title, text, buttonLabel, onContinue }) {
  const btn = h("button", { type: "button", class: "btn btn-primary", onClick: onContinue }, `${buttonLabel} `, kbd("Enter"));
  return {
    node: card(h("h2", { class: "wu-title" }, title), h("p", { class: "wu-prompt" }, text), btn),
    focus: () => btn.focus(),
    refreshNext: () => {},
    onKey(e) {
      if (e.key === "Enter" || e.key === " ") { onContinue(); return true; }
      return false;
    },
  };
}

// data: { summary, wrongWords: [{ word, meaningVi }], wrongErrors: [{ original, corrected, explanationVi }],
//         suggestions: [{ id, original, corrected, streak }], next: { book, test } | null }
export function renderSummary(data, hooks) {
  const s = data.summary;
  const stat = (value, label) => h("div", { class: "wu-stat" }, h("p", { class: "wu-stat-value nowrap" }, value), h("p", { class: "wu-stat-label" }, label));

  const wordList = data.wrongWords.length
    ? h("ul", { class: "wu-list" }, data.wrongWords.map((w) => h("li", { class: "wu-list-item" },
      h("div", {}, h("strong", {}, w.word), w.meaningVi ? h("span", { class: "muted" }, ` · ${w.meaningVi}`) : h("span", { class: "muted" }, " · chưa có nghĩa")),
      h("span", { class: "muted nowrap" }, "Quay lại hộp 1"),
      speakButton(w.word))))
    : h("p", { class: "muted" }, s.vocabTotal ? "Không có từ nào trả lời sai." : "Hôm nay không có từ nào được chấm.");

  const errorList = data.wrongErrors.length
    ? h("ul", { class: "wu-list" }, data.wrongErrors.map((e) => h("li", { class: "wu-list-item wu-list-col" },
      h("p", {}, h("span", { class: "wu-struck" }, e.original), " → ", h("strong", {}, e.corrected)),
      e.explanationVi ? h("p", { class: "muted" }, e.explanationVi) : null)))
    : h("p", { class: "muted" }, s.errorsTotal ? "Không có lỗi nào làm sai." : "Hôm nay không có lỗi nào được chấm.");

  const suggestions = data.suggestions.length
    ? h("section", { class: "wu-card" },
      h("h2", { class: "wu-title" }, "Đề xuất đánh dấu đã khắc phục"),
      h("p", { class: "muted" }, "Các lỗi này đã được làm đúng từ 3 buổi khởi động liên tiếp."),
      h("ul", { class: "wu-list" }, data.suggestions.map((e) => {
        const btn = h("button", { type: "button", class: "btn btn-outline btn-sm", onClick: async () => {
          btn.disabled = true;
          try {
            await hooks.markFixed(e.id);
            btn.replaceWith(h("span", { class: "tag nowrap" }, "Đã đánh dấu"));
          } catch {
            btn.disabled = false;
          }
        } }, "Đánh dấu đã khắc phục");
        return h("li", { class: "wu-list-item" }, h("div", {}, h("span", { class: "wu-struck" }, e.original), " → ", h("strong", {}, e.corrected)), btn);
      })))
    : null;

  const node = h("div", { class: "wu-summary" },
    card(
      h("h1", { class: "wu-title" }, "Xong buổi khởi động"),
      h("div", { class: "wu-stats" },
        stat(`${s.vocabCorrect}/${s.vocabTotal} từ`, "nhớ"),
        stat(`${s.errorsCorrect}/${s.errorsTotal} lỗi`, "sửa đúng")),
      s.vocabNear || s.vocabSkipped || s.errorsSkipped
        ? h("p", { class: "muted" }, [s.vocabNear ? `Nhớ mơ hồ: ${s.vocabNear} từ. ` : "", s.vocabSkipped ? `Bỏ qua: ${s.vocabSkipped} từ. ` : "", s.errorsSkipped ? `Bỏ qua: ${s.errorsSkipped} lỗi.` : ""]) : null),
    card(h("h2", { class: "wu-title" }, "Từ cần ôn lại"), wordList),
    card(h("h2", { class: "wu-title" }, "Lỗi cần lưu ý"), errorList),
    suggestions,
    data.next
      ? card(h("p", { class: "wu-tag-small" }, "Buổi luyện tiếp theo"), h("p", { class: "wu-title" }, `Cam ${data.next.book} · Test ${data.next.test}`))
      : null,
    h("div", { class: "wu-actions" },
      data.next ? h("a", { class: "btn btn-primary", href: `#/practice/${data.next.book}/${data.next.test}` }, `Vào luyện Cam ${data.next.book} · Test ${data.next.test}`) : null,
      h("a", { class: "btn btn-outline", href: "#/" }, "Về Dashboard")));

  return { node, refreshNext: () => {}, onKey: () => false };
}
