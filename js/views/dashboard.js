// Dashboard (spec 5.1): next practice session, four number cards, recent activity, backup (phones).
// Every number is computed from the tables when the page opens (spec 6.8); nothing is stored for it.
import { h } from "../components/dom.js";
import { mountBackupControls } from "../components/backup-ui.js";
import { loadDashboardData } from "../services/practice-store.js";
import { computeDashboard } from "../services/dashboard-stats.js";
import { formatBand } from "../services/bands.js";
import { isoDate } from "../services/leitner.js";

const REASONS = { pinned: "Đã ghim", continue: "Tiếp tục cuốn đang làm", "next-book": "Cuốn kế tiếp", start: "Bắt đầu từ đầu" };
const SKILL_KEYS = ["L", "R", "W", "S"];

// ---- Hero ----
function hero(d) {
  const next = d.next;
  const testText = next ? `Cam ${next.book} · Test ${next.test}` : null;
  const testHref = next ? `#/practice/${next.book}/${next.test}` : null;

  const actions = [];
  if (d.warmedToday) {
    if (next) actions.push(h("a", { class: "btn btn-hero", href: testHref }, `Vào luyện ${testText}`));
    actions.push(h("a", { class: next ? "hero-link" : "btn btn-hero", href: "#/warmup" }, "Khởi động thêm"));
  } else {
    actions.push(h("a", { class: "btn btn-hero", href: "#/warmup" }, "Bắt đầu buổi luyện (khởi động 15 phút)"));
    if (next) actions.push(h("a", { class: "hero-link", href: testHref }, "Bỏ khởi động, mở test luôn"));
  }

  return h("section", { class: "hero", "aria-label": "Buổi luyện tiếp theo" },
    h("p", { class: "hero-chip nowrap" }, `Đến hạn ôn: ${d.due.words} từ · ${d.due.errors} lỗi`),
    next
      ? h("h2", { class: "hero-title" }, "Buổi luyện tiếp theo: ", h("span", { class: "nowrap" }, testText))
      : h("h2", { class: "hero-title" }, "Bạn đã làm xong mọi test Cam 10–19"),
    next ? h("p", { class: "hero-reason" }, REASONS[next.reason]) : null,
    h("div", { class: "hero-actions" }, actions));
}

// ---- Four number cards (each one is a link to a screen with the filter already set) ----
const bar = (pct, label) => h("div", { class: "bar", role: "progressbar", "aria-label": label, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct) },
  h("div", { class: "bar-fill", style: `width:${pct}%` }));

const card = (href, label, value, unit, ...rest) => h("a", { class: "stat-card", href },
  h("p", { class: "stat-label", title: label }, label),
  h("p", { class: "stat-value" }, h("span", { class: "nowrap" }, value), unit ? h("span", { class: "stat-unit nowrap" }, ` ${unit}`) : null),
  ...rest);

function statCards(d) {
  const p = d.progress;
  const b = d.band;
  const v = d.vocab;
  const e = d.errors;

  const progress = card(p.href, "Tiến độ Cam 10–19", `${p.done}/${p.total}`, `test (${p.pct}%)`,
    bar(p.pct, "Tiến độ Cam 10–19"),
    h("p", { class: "stat-sub" }, p.currentBook ? `Đang học quyển Cam ${p.currentBook}` : "Chưa làm test nào"));

  const bandSub = b.overall === null ? "Cần ít nhất 2 kỹ năng" : b.estimated ? `Overall ước tính (${b.count}/4)` : "Overall";
  const target = `Mục tiêu ${formatBand(b.target)}${b.overall === null ? "" : b.reached ? " · Đã đạt mục tiêu" : ` · còn thiếu ${b.gap.toFixed(1)}`}`;
  const band = card(b.href, "Band trung bình", b.overall === null ? "–" : formatBand(b.overall), null,
    h("p", { class: "stat-sub" }, bandSub),
    h("p", { class: "stat-skills" }, SKILL_KEYS.map((k) => h("span", { class: "nowrap" }, `${k} ${b.skills[k] === null ? "–" : formatBand(b.skills[k])}`))),
    bar(b.pct, "Band trung bình so với mục tiêu"),
    h("p", { class: "stat-sub" }, target));

  const vocab = card(v.href, "Từ vựng đã lưu", String(v.total), "từ",
    h("p", { class: "stat-sub" }, h("span", { class: "nowrap" }, `+ ${v.due} đến hạn`), " · ", h("span", { class: "nowrap" }, `+ ${v.pending} chờ hoàn thiện`)));

  const errSub = e.top ? `Nhóm nhiều nhất: ${e.top.label} (${e.top.count} lỗi)` : e.total === 0 ? "Chưa có lỗi nào" : "Đã khắc phục hết";
  const errors = card(e.href, "Lỗi cần khắc phục", String(e.open), "lỗi", h("p", { class: "stat-sub" }, errSub));

  return h("section", { class: "stat-grid", "aria-label": "Tóm tắt" }, progress, band, vocab, errors);
}

// ---- Recent activity, or the three first steps when there is nothing yet ----
function activitySection(d) {
  const section = h("section", { class: "activity" });
  if (d.isEmpty) {
    section.append(
      h("h2", { class: "section-title" }, "Bắt đầu trong 3 bước"),
      h("ol", { class: "guide" },
        guideStep("Làm một đề Cam trên sách hoặc PDF của bạn, rồi nhập điểm.", "#/practice", "Mở Cambridge Practice"),
        guideStep("Ghi nhanh từ mới và lỗi trong lúc làm bài (nhấn N).", "#/vocab", "Mở Từ vựng"),
        guideStep("Mỗi ngày khởi động 15 phút để ôn từ đến hạn và luyện lại lỗi.", "#/warmup", "Bắt đầu khởi động")));
    return section;
  }
  section.append(h("h2", { class: "section-title" }, "Hoạt động gần đây"));
  if (d.activity.length === 0) {
    section.append(h("p", { class: "muted" }, "Chưa có hoạt động nào được ghi lại."));
    return section;
  }
  section.append(h("ul", { class: "activity-list" }, d.activity.map((a) => h("li", { class: "activity-item", dataset: { kind: a.kind } },
    h("span", { class: "activity-date nowrap" }, a.dateLabel),
    h("div", { class: "activity-main" },
      h("p", { class: "activity-title" }, a.title),
      a.detail ? h("p", { class: "activity-detail" }, a.detail) : null),
    h("a", { class: "link activity-link", href: a.href }, a.linkLabel)))));
  return section;
}

const guideStep = (text, href, linkLabel) => h("li", { class: "guide-step" },
  h("span", { class: "guide-text" }, text), h("a", { class: "link", href }, linkLabel));

// ---- Page ----
export function dashboardView(container) {
  const body = h("div", { class: "dashboard-body" }, h("p", { class: "muted" }, "Đang tải…"));

  const backupHost = h("div", {});
  const backup = h("section", { class: "dashboard-backup" }, h("h2", { class: "section-label" }, "Dữ liệu"), backupHost);
  mountBackupControls(backupHost, "outline");

  container.replaceChildren(h("h1", { class: "page-title" }, "Dashboard"), body, backup);

  const load = () => loadDashboardData().then((data) => {
    if (!container.contains(body)) return; // the user already moved to another page
    const d = computeDashboard({ ...data, today: isoDate() });
    body.replaceChildren(hero(d), statCards(d), activitySection(d));
  }).catch((err) => {
    if (container.contains(body)) body.replaceChildren(h("p", { class: "form-error" }, `Không đọc được dữ liệu: ${err.message}`));
  });
  load();

  // Quick capture and restore announce new data: refresh the numbers while this page is open.
  const onChange = () => {
    if (!container.contains(body)) document.removeEventListener("elh:data-changed", onChange);
    else load();
  };
  document.addEventListener("elh:data-changed", onChange);
}
