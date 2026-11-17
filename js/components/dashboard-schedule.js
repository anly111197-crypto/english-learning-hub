// "Lịch học" on the Dashboard (spec 5.1): today's session, the 7 days of this week and the progress line.
// Everything is computed from the saved settings + the attempts each time (nothing per day is stored).
import { h } from "./dom.js";
import { openScheduleDialog } from "./schedule-dialog.js";
import { buildSchedule, briefItems, itemHref, itemLabel, WEEKDAY_LABELS, WARMUP_MINUTES } from "../services/schedule.js";

const dm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const dayName = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return WEEKDAY_LABELS[new Date(y, m - 1, d).getDay() || 7];
};

// record: stored settings or null; attempts: all attempts; today: "YYYY-MM-DD"; onChange(): reload after saving
export function scheduleSection({ record, attempts, today, onChange }) {
  const open = () => openScheduleDialog({ current: record, today, onSaved: onChange });
  const settingsBtn = (label = "Cài đặt lịch") => h("button", { type: "button", class: "btn btn-outline sch-settings", dataset: { role: "sch-settings" }, onClick: open }, label);

  if (!record) {
    return h("section", { class: "sched sched-invite", "aria-label": "Lịch học", dataset: { role: "sched-invite" } },
      h("div", { class: "sched-head" }, h("h2", { class: "section-title" }, "Lịch học")),
      h("p", {}, "Cài lịch để biết hôm nay và tuần này cần làm gì, theo lộ trình luyện hết Cam 10–19 trước ngày thi."),
      settingsBtn("Cài đặt lịch"));
  }

  const s = buildSchedule({ settings: record, attempts, today });
  const head = h("div", { class: "sched-head" }, h("h2", { class: "section-title" }, "Lịch học"), settingsBtn());
  return h("section", { class: "sched", "aria-label": "Lịch học", dataset: { role: "sched" } },
    head, todayCard(s, today), warning(s), weekStrip(s), progressLine(s));
}

function itemRow(it) {
  return h("li", { class: "sched-item", dataset: { done: String(Boolean(it.done)), skill: it.skill, href: itemHref(it) } },
    h("span", { class: "sched-mark", "aria-hidden": "true" }, it.done ? "✓" : "○"),
    h("a", { class: "sched-link", href: itemHref(it) }, itemLabel(it)),
    h("span", { class: "sched-min muted nowrap" }, `${it.minutes}'`));
}

function todayCard(s, today) {
  const title = `Hôm nay · ${dayName(today)} ${dm(today)}`;
  if (s.finished && !s.todaySession) {
    return h("article", { class: "sched-today", dataset: { role: "sched-today", state: "finished" } },
      h("h3", { class: "sched-today-title" }, title), h("p", {}, "Bạn đã làm xong mọi bài trong Cam 10–19. Không còn gì cần xếp."));
  }
  if (!s.todaySession) {
    return h("article", { class: "sched-today", dataset: { role: "sched-today", state: s.todayIsStudy ? "done" : "rest" } },
      h("h3", { class: "sched-today-title" }, title),
      h("p", { class: "sched-rest" }, s.todayIsStudy ? "Hôm nay không còn bài nào cần xếp." : "Hôm nay nghỉ."),
      s.next ? h("p", { class: "muted", dataset: { role: "sched-next" } }, `Buổi kế tiếp: ${dayName(s.next.date)} ${dm(s.next.date)} · ${briefItems(s.next.session.items)}`) : null);
  }
  const t = s.todaySession;
  const firstOpen = t.items.find((it) => !it.done);
  const allDone = !firstOpen;
  return h("article", { class: "sched-today", dataset: { role: "sched-today", state: allDone ? "done" : "todo" } },
    h("h3", { class: "sched-today-title" }, title),
    h("ul", { class: "sched-items" },
      h("li", { class: "sched-item sched-warm", dataset: { role: "sched-warmup" } },
        h("span", { class: "sched-mark", "aria-hidden": "true" }, "•"),
        h("a", { class: "sched-link", href: "#/warmup" }, "Khởi động 15'"),
        h("span", { class: "sched-min muted nowrap" }, `${WARMUP_MINUTES}'`)),
      t.items.map(itemRow)),
    h("p", { class: "muted sched-note", dataset: { role: "sched-note" } },
      `Khoảng ${t.totalMinutes} phút${t.note ? ` · ${t.note}` : ""}`),
    allDone
      ? h("p", { class: "sched-done", dataset: { role: "sched-done" } }, "✓ Đã xong buổi hôm nay.")
      : h("a", { class: "btn btn-primary sched-start", href: itemHref(firstOpen), dataset: { role: "sched-start" } }, "Bắt đầu"),
    firstOpen?.skill === "S"
      ? h("p", { class: "muted sched-note" }, "Speaking ghi điểm ở panel test. Muốn thu âm: ", h("a", { class: "link", href: "#/ai/speaking" }, "Luyện nói với thu âm"), ".")
      : null);
}

function warning(s) {
  if (!s.shortfall) return null;
  const p = s.progress;
  return h("p", { class: "sched-warning", role: "status", dataset: { role: "sched-warning" } },
    `Thiếu ${s.shortfall} buổi trước ngày thi (cần ${p.sessionsNeeded} buổi, chỉ có ${p.sessionsAvailable}). `,
    "Thêm ngày học trong tuần",
    s.settings.order === "old" ? ", hoặc chuyển sang “Cam mới trước”." : ".");
}

function weekStrip(s) {
  const cell = (d) => {
    let body;
    if (d.state === "done") {
      const shown = d.session && d.isToday ? d.session.items : d.done;
      body = [h("span", { class: "sched-tick", "aria-label": "Đã xong" }, "✓"), h("span", { class: "sched-day-text" }, briefItems(shown))];
    } else if (d.state === "missed") body = [h("span", { class: "sched-day-text" }, "Bỏ lỡ")];
    else if (d.state === "off") body = [h("span", { class: "sched-day-text" }, "Nghỉ")];
    else body = [h("span", { class: "sched-day-text" }, briefItems(d.session.items))];
    return h("li", { class: "sched-day", dataset: { date: d.date, state: d.state, today: String(d.isToday) } },
      h("span", { class: "sched-day-head" }, h("strong", {}, d.label), h("span", { class: "muted nowrap" }, dm(d.date))), body);
  };
  return h("ol", { class: "sched-week", "aria-label": "7 ngày của tuần này", dataset: { role: "sched-week" } }, s.week.map(cell));
}

function progressLine(s) {
  const p = s.progress;
  const left = p.hasExam
    ? `còn ${Math.max(0, p.sessionsLeft)} buổi đến ngày thi (${s.settings.examDate.split("-").reverse().join("/")})`
    : `ước còn ${Math.max(0, p.sessionsLeft)} buổi (chưa đặt ngày thi)`;
  return h("p", { class: "sched-progress", dataset: { role: "sched-progress" } },
    h("span", { class: "nowrap" }, `Đã xong ${p.doneItems}/${p.total} bài (tính từng kỹ năng)`), " · ", h("span", {}, left));
}
