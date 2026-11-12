// Sync status line (sidebar footer and the Dashboard card on phones) and the Google Drive dialog.
import { h } from "./dom.js";
import { openModal, confirmModal } from "./modal.js";
import { showToast } from "./toast.js";
import { describeSync } from "../services/sync-status.js";
import { getSyncState, isConnected, connect, disconnect, syncNow, loadGis } from "../services/sync-controller.js";
import { isGisReady } from "../services/google-auth.js";

const CONNECT_ERRORS = {
  popup_closed: "Bạn đã đóng cửa sổ đăng nhập Google.",
  access_denied: "Bạn chưa cấp quyền cho Google Drive.",
  popup_failed_to_open: "Trình duyệt chặn cửa sổ đăng nhập. Hãy cho phép cửa sổ bật lên rồi bấm lại.",
};

function connectErrorText(e) {
  if (e?.code === "superseded") return "";
  return CONNECT_ERRORS[e?.code] ?? e?.message ?? "Không kết nối được Google Drive.";
}

// Click handler body: connect() must run synchronously here (Safari iOS popup rule), so no await before it.
function startConnect() {
  connect().catch((e) => {
    const msg = connectErrorText(e);
    if (msg) showToast(msg, "error");
  });
}

export function openSyncDialog() {
  const body = h("div", { class: "sync-dialog" });
  let modal = null;

  function render() {
    const s = getSyncState();
    const d = describeSync(s);
    const connected = isConnected();
    const actions = h("div", { class: "modal-actions" });

    if (!connected || s.status === "needs-login") {
      const ready = isGisReady();
      actions.append(h("button", {
        type: "button", class: "btn btn-primary", disabled: !ready,
        onClick: startConnect,
      }, !ready ? "Đang tải đăng nhập Google…" : connected ? "Đăng nhập lại" : "Kết nối Google Drive"));
    }
    if (connected) {
      actions.append(
        h("button", {
          type: "button", class: "btn btn-outline", disabled: s.status === "syncing" || s.status === "needs-login",
          onClick: () => syncNow(),
        }, "Đồng bộ ngay"),
        h("button", {
          type: "button", class: "btn btn-text",
          onClick: async () => {
            const ok = await confirmModal({
              title: "Ngắt kết nối Google Drive?",
              message: "Dữ liệu trên máy này giữ nguyên, dữ liệu trên Drive cũng không bị xoá. Chỉ ngừng đồng bộ trên máy này.",
              confirmLabel: "Ngắt kết nối",
            });
            if (ok) disconnect();
          },
        }, "Ngắt kết nối"),
      );
    }

    const parts = [h("p", { class: "sync-dialog-state", dataset: { level: d.level } }, d.text)];
    if (s.status === "error" && s.message) parts.push(h("p", { class: "sync-dialog-error" }, s.message));
    parts.push(
      h("p", { class: "sync-dialog-note" },
        "Dữ liệu được lưu trong thư mục riêng của ứng dụng trên Google Drive của bạn (không thấy trong danh sách tệp). " +
        "Lần đầu trên mỗi máy, app tải xuống một bản sao lưu rồi gộp với dữ liệu trên Drive, không ghi đè."),
      actions,
    );
    body.replaceChildren(...parts);
  }

  const onState = () => render();
  document.addEventListener("elh:sync-state", onState);
  modal = openModal({
    title: "Đồng bộ Google Drive",
    content: body,
    onClose: () => document.removeEventListener("elh:sync-state", onState),
  });
  render();
  if (!isGisReady()) loadGis().then(render, () => showToast("Không nạp được dịch vụ đăng nhập Google. Kiểm tra mạng rồi thử lại.", "error"));
  return modal;
}

// A one-line status that opens the dialog. variant: "navy" (sidebar) | "card" (Dashboard).
export function mountSyncStatus(container, variant = "navy") {
  const dot = h("span", { class: "sync-dot", "aria-hidden": "true" });
  const text = h("span", { class: "sync-text nowrap" });
  const line = h("button", { type: "button", class: `sync-line sync-${variant}`, onClick: openSyncDialog }, dot, text);
  container.replaceChildren(line);

  const paint = () => {
    const d = describeSync(getSyncState());
    text.textContent = d.text;
    line.dataset.level = d.level;
    line.title = `${d.text}. Bấm để mở cài đặt đồng bộ Google Drive.`;
  };
  // Stop listening once the page that holds this line has been replaced. (Not checked on the first paint:
  // the Dashboard mounts it before attaching it to the document.)
  const refresh = () => {
    if (!container.isConnected) {
      document.removeEventListener("elh:sync-state", refresh);
      clearInterval(timer);
      return;
    }
    paint();
  };
  document.addEventListener("elh:sync-state", refresh);
  const timer = setInterval(refresh, 30000); // "x phút trước" ages on its own
  paint();
}
