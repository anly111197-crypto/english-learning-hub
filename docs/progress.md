# Progress handoff

Đọc cùng `docs/spec.md` (roadmap mục 10), `docs/decisions.md` (nhật ký quyết định) và `.agent/rules/elh-project.md` (luật làm việc: mỗi lần một bước, kế hoạch trước khi code, commit kết thúc bằng dòng Co-Authored-By).

## 1. Các bước đã xong

| Bước | Nội dung | Commit |
|---|---|---|
| 1 | App shell, router, layout, PWA | `e52281f` |
| 2 | IndexedDB + sao lưu JSON | `615e93d` |
| 3 | Cambridge Practice (tracker) | `f26b2d8` |
| 4a | Ghi nhanh + Vocabulary Bank | `f85285a` (+ `b2bd5ed` nguồn mặc định hết hạn sau 3 giờ) |
| 4b | Grammar Notebook + tab Notebook | `c5f54c4` (+ `8ced787` chip cuộn ngang) |
| 5 | Khởi động 15 phút (Leitner đầy đủ) | `dd70490` |
| 6 | Dashboard | `3217c47` |

## 2. Quy ước chưa có trong spec

- **`elh:data-changed`** (sự kiện trên `document`): phát sau mọi thay đổi dữ liệu từ giao diện (ghi nhanh, form notebook, khôi phục, nút dev). Mỗi view danh sách và dòng nhắc sao lưu tự nạp lại khi nghe nó. View mới ghi dữ liệu phải phát sự kiện này. `elh:backup-done` phát sau khi sao lưu.
- **`components/overlay.js`**: bộ đếm lớp phủ; đặt `body[data-overlay-open]` để ẩn nút FAB. Sheet và modal (`<dialog>`) đều đi qua nó; dialog mới phải dùng `overlay.js`.
- **Query của router**: `#/vocab?due=1`, `#/errors?type=articles&status=open`, `#/practice?status=improve&skill=R`. Router gọi `view.mount(container, params, query)` và `update(params, query)`. View đặt lại bộ lọc mỗi lần mở rồi áp query, nên link từ Dashboard luôn mở đúng bộ lọc.
- **`?dev=1`** (query đứng trước dấu `#`): bật route `#/dev` (dữ liệu mẫu, kiểm tra tự động, nút "Đặt mọi từ đến hạn hôm nay"). `&autorun=1` tự chạy kiểm tra. **`&clock=GIÂY`** rút ngắn đồng hồ từng bước khởi động để thử "hết giờ" (chỉ có hiệu lực khi có `dev=1`).
- **Số liệu Dashboard** luôn tính lại từ bảng khi mở trang (`services/dashboard-stats.js`), không lưu. Hàm thuần thì có test, view chỉ vẽ.
- **Service worker** network-first. Mỗi bước phải tăng `CACHE_VERSION` (nay `elh-v7`) và giữ `APP_SHELL` đủ file.
- **Giao diện**: chỉ dùng token trong `css/tokens.css` (không viết mã màu cứng); chữ UI tiếng Việt, mã và comment tiếng Anh.
- **Xoá mềm**: bản ghi có `deleted`; tạo lại cùng id thì hồi sinh. `vocab.lemmaPos`, `notes.linkKeys` là chỉ mục dẫn xuất.

**Kiểm thử**
- Đơn vị: `node --test tests/*.test.js` (164 test, pass).
- Headless (Chrome qua CDP, phím và chuột thật): `python -m http.server 8765` ở thư mục repo, rồi `node tests/e2e/run.mjs <kịch bản> [thư-mục-xuất]`. Danh sách kịch bản và cách đọc kết quả: `tests/e2e/README.md`. Script luôn thoát mã 0, phải tự đọc `FAIL` và dòng `console problems`. Không nằm trong `APP_SHELL`.

## 3. Chưa thử trên thiết bị thật

- Safari iOS và iPad thật, thao tác chạm, Add to Home Screen.
- Service worker offline (chỉ kiểm tra mọi file trong `APP_SHELL` tồn tại).
- Âm thanh phát âm thật (Web Speech), mở CSV trong Excel thật, đầu ra NotebookLM thật.
- Màn hình iPad 768–1023px: chỉ suy ra từ quy tắc CSS, chưa chụp riêng.

## 4. Bước tiếp theo

1. **6b — Luyện đề** (spec giai đoạn 3, mục 10): chọn PDF/MP3 từ máy bằng `<input type=file>`, xem PDF bằng trình xem của trình duyệt, audio tua ±5s, đồng hồ 30/60', hết giờ mở modal nhập điểm. File chỉ đọc trong phiên, không lưu IndexedDB, không đồng bộ. Cần kế hoạch và danh sách file được duyệt trước khi code.
2. **7 — Đồng bộ Google Drive** (scope `drive.appdata`, file `elh-data.json`; mục tiêu: sửa trên iPhone, mở Windows thấy trong ≤ 1 phút). Cần Google Cloud Client ID của người dùng. Dùng lại `merge.js` và `backup.js`.
3. Sau đó: 8 (AI copy/paste, nhãn "Claude"), 9 (Cloudflare Worker proxy).
