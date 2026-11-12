import { h } from "../components/dom.js";
import { mountBackupControls } from "../components/backup-ui.js";
import { loadPracticeData } from "../services/practice-store.js";
import { nextTest } from "../services/next-test.js";
import { loadDueCounts } from "../services/warmup-ops.js";

const REASONS = { pinned: "Đã ghim", continue: "Tiếp tục cuốn đang làm", "next-book": "Cuốn kế tiếp", start: "Bắt đầu" };

// Placeholder until Step 6: next practice session + (on phones) backup buttons.
export function dashboardView(container) {
  const nextHost = h("section", { class: "next-card" }, h("p", { class: "muted" }, "Đang tải…"));

  const backupHost = h("div", {});
  const backup = h("section", { class: "dashboard-backup" }, h("h2", { class: "section-label" }, "Dữ liệu"), backupHost);
  mountBackupControls(backupHost, "outline");

  const dueLine = h("p", { class: "due-line nowrap" }, "Đang tải…");
  const warmupCard = h("section", { class: "next-card" },
    h("p", { class: "summary-label" }, "Khởi động 15 phút"),
    dueLine,
    h("a", { class: "btn btn-primary", href: "#/warmup" }, "Bắt đầu buổi luyện (khởi động 15 phút)"));

  container.replaceChildren(h("h1", { class: "page-title" }, "Dashboard"), warmupCard, nextHost, backup);

  loadDueCounts().then(({ words, errors }) => {
    dueLine.textContent = `Đến hạn: ${words} từ · ${errors} lỗi`;
  }).catch(() => { dueLine.textContent = ""; });

  loadPracticeData().then((data) => {
    const next = nextTest(data);
    if (!container.contains(nextHost)) return; // the user already moved to another page
    if (!next) {
      nextHost.replaceChildren(h("p", { class: "next-title" }, "Bạn đã làm xong mọi test trong Cam 10–19."));
      return;
    }
    nextHost.replaceChildren(
      h("p", { class: "summary-label" }, "Buổi luyện tiếp theo"),
      h("p", { class: "next-title nowrap" }, `Cam ${next.book} · Test ${next.test}`),
      h("p", { class: "summary-sub" }, REASONS[next.reason]),
      h("a", { class: "btn btn-primary", href: `#/practice/${next.book}/${next.test}` }, "Mở test này"));
  }).catch((err) => {
    nextHost.replaceChildren(h("p", { class: "form-error" }, `Không đọc được dữ liệu: ${err.message}`));
  });
}
