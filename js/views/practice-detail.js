// Content of the test panel (right-hand panel / bottom sheet).
import { h, formatDateVi } from "../components/dom.js";
import { bandCell } from "../components/band-cell.js";
import { formatBand } from "../services/bands.js";
import { testSummary } from "../services/progress.js";
import { isHttpsUrl } from "../services/practice-store.js";
import { errorTypeLabel, SKILL_LABELS, partLabel } from "../services/taxonomy.js";

const ROWS = [
  { skill: "L", task: null, label: "Listening", att: (e) => e?.L },
  { skill: "R", task: null, label: "Reading", att: (e) => e?.R },
  { skill: "W", task: 1, label: "Writing Task 1", att: (e) => e?.W1 },
  { skill: "W", task: 2, label: "Writing Task 2", att: (e) => e?.W2 },
  { skill: "S", task: null, label: "Speaking", att: (e) => e?.S },
];

function skillRow(row, entry, onEdit) {
  const att = row.att(entry);
  const letter = row.skill;
  const meta = att
    ? [formatDateVi(att.date), att.durationMin ? `${att.durationMin} phút` : null].filter(Boolean).join(" · ")
    : "Chưa có kết quả";
  const score = att
    ? (typeof att.rawScore === "number" ? `${att.rawScore}/40 · Band ${formatBand(att.band)}` : `Band ${formatBand(att.band)}`)
    : "–";
  return h("li", { class: "skill-row" },
    bandCell({ letter, band: att ? att.band : null }),
    h("div", { class: "skill-info" },
      h("p", { class: "skill-name" }, row.label, " ", h("span", { class: "skill-score nowrap" }, score)),
      h("p", { class: "skill-meta" }, meta),
      att?.note ? h("p", { class: "skill-note" }, att.note) : null),
    h("button", { type: "button", class: "btn btn-outline btn-sm", onClick: () => onEdit(row.skill, row.task) }, att ? "Sửa" : "Nhập"));
}

function overallLine(summary) {
  const o = summary.overall;
  if (o.value === null) return h("p", { class: "overall muted" }, "Chưa đủ kỹ năng để ước tính overall (cần ít nhất 2).");
  return h("p", { class: "overall" },
    h("span", {}, o.estimated ? "Overall ước tính: " : "Overall: "),
    h("strong", { class: "nowrap" }, formatBand(o.value)),
    o.estimated ? h("span", { class: "muted nowrap" }, ` · Ước tính (${o.count}/4 kỹ năng)`) : null);
}

function writingLine(summary) {
  const w = summary.writing;
  if (!w) return null;
  const value = formatBand(w.value) + (w.marked ? "*" : "");
  const how = w.marked ? `(mới có Task ${w.only}, chỉ lấy từ Task ${w.only})` : "= (Task 1 + 2 × Task 2) ÷ 3";
  return h("p", { class: "writing-estimate" },
    "Writing ước tính: ", h("strong", { class: "nowrap" }, value), " ", how,
    h("span", { class: "muted" }, " Công thức ước lượng, không phải công thức chính thức."));
}

function linksBlock(testRec) {
  const pdf = isHttpsUrl(testRec?.pdfUrl) ? testRec.pdfUrl : null;
  const audio = (testRec?.audioUrls ?? []).map((u, i) => (isHttpsUrl(u) ? { part: i + 1, url: u } : null)).filter(Boolean);
  if (!pdf && audio.length === 0) return null;
  const link = (href, text) => h("a", { class: "btn btn-outline", href, target: "_blank", rel: "noopener noreferrer" }, text);
  return h("div", { class: "link-buttons" },
    pdf ? link(pdf, "Mở đề PDF") : null,
    audio.map((a) => link(a.url, `Mở audio Part ${a.part}`)));
}

// Words and errors that were met in this test. items = { vocab: [{ rec, source }], errors: [{ rec, source }] }
function itemsBlock(items, onCapture) {
  const nV = items.vocab.length;
  const nE = items.errors.length;
  const where = (source) => (source?.skill ? ` · ${SKILL_LABELS[source.skill]}${source.part ? " " + partLabel(source.skill, source.part) : ""}` : "");
  const list = nV + nE === 0
    ? h("p", { class: "muted" }, "Chưa có mục nào.")
    : h("div", { class: "test-items" },
      h("p", { class: "muted" }, `${nV} từ · ${nE} lỗi`),
      nV ? h("ul", { class: "item-list" }, items.vocab.map(({ rec, source }) => h("li", {},
        h("strong", {}, rec.word),
        h("span", { class: "muted" }, ` ${rec.meaningVi ? "· " + rec.meaningVi : ""}${where(source)}`),
        rec.enriched ? null : [" ", h("span", { class: "tag nowrap" }, "Chờ hoàn thiện")]))) : null,
      nE ? h("ul", { class: "item-list" }, items.errors.map(({ rec, source }) => h("li", {},
        h("span", {}, rec.original),
        rec.corrected ? h("span", { class: "muted" }, " → ") : null,
        rec.corrected ? h("strong", {}, rec.corrected) : null,
        h("span", { class: "muted nowrap" }, ` · ${rec.type ? errorTypeLabel(rec.type) : "Chưa rõ nhóm"}${rec.occurrences > 1 ? ` · ×${rec.occurrences}` : ""}${where(source)}`),
        rec.enriched ? null : [" ", h("span", { class: "tag nowrap" }, "Chờ hoàn thiện")]))) : null);
  return [
    h("h3", { class: "section-label" }, "Từ mới & lỗi của test này"),
    list,
    h("button", { type: "button", class: "btn btn-outline btn-sm", onClick: onCapture }, "+ Ghi nhanh cho test này"),
  ];
}

// ctx: { book, test, entry, testRec, isNext, items }
// on:  { edit(skill, task), enterResults(), togglePin(), editLinks(), quickCapture() }
export function buildDetail(ctx, on) {
  const { book, test, entry, testRec, isNext, items } = ctx;
  const summary = testSummary(entry);
  const pinned = Boolean(testRec?.pinned);

  const node = h("div", { class: "detail" },
    overallLine(summary),
    h("h3", { class: "section-label" }, "Kỹ năng bài test"),
    h("ul", { class: "skill-list" }, ROWS.map((r) => skillRow(r, entry, on.edit))),
    writingLine(summary),
    h("div", { class: "detail-actions" },
      h("button", { type: "button", class: "btn btn-primary", onClick: on.enterResults }, "Nhập kết quả"),
      h("button", { type: "button", class: "btn btn-outline", "aria-pressed": String(pinned), onClick: on.togglePin },
        pinned ? "Bỏ ghim buổi tiếp theo" : "Ghim làm buổi tiếp theo")),
    isNext ? h("p", { class: "next-note" }, pinned ? "Đang ghim làm buổi luyện tiếp theo." : "Đây là buổi luyện tiếp theo.") : null,
    h("h3", { class: "section-label" }, "Đề và audio của bạn"),
    linksBlock(testRec) ?? h("p", { class: "muted" }, "Chưa có link."),
    h("button", { type: "button", class: "btn btn-text btn-sm", onClick: on.editLinks }, "Sửa link"),
    itemsBlock(items ?? { vocab: [], errors: [] }, on.quickCapture));

  return {
    title: `Cam ${book} · Test ${test}`,
    badge: `${summary.skillsDone}/4 kỹ năng`,
    node,
  };
}
