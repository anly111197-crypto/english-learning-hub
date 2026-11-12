# E2E scripts (headless Chrome)

`run.mjs` lái Chrome headless qua Chrome DevTools Protocol với phím và chuột thật, để thử giao diện thật của app. Không phải một phần của app: không đưa vào `APP_SHELL`. Không dùng thư viện ngoài, chỉ cần Node (có `fetch` và `WebSocket`, Node 22+) và Chrome.

## Cách chạy

1. Mở một cửa sổ terminal, chạy server tĩnh ở thư mục gốc repo (cổng phải là 8765):
   ```
   python -m http.server 8765
   ```
2. Ở terminal khác, cũng tại thư mục gốc repo:
   ```
   node tests/e2e/run.mjs <kịch-bản> [thư-mục-xuất]
   ```
   - `thư-mục-xuất` (tuỳ chọn, mặc định là thư mục tạm của hệ điều hành) chứa ảnh chụp màn hình, `bad.json` và thư mục `downloads/`.
   - Chrome mặc định ở `C:/Program Files/Google/Chrome/Application/chrome.exe`; nơi khác thì đặt `CHROME_PATH`.
   - Mỗi lần chạy dùng hồ sơ Chrome tạm mới, nên IndexedDB luôn bắt đầu rỗng.
3. Đọc kết quả: dòng `PASS`/`FAIL`, dòng cuối `console problems: none`. **Script luôn thoát với mã 0**, nên phải nhìn chữ `FAIL` hoặc `console problems` khác `none`, không dựa vào mã thoát.

Test đơn vị chạy riêng: `node --test tests/*.test.js`.

## Kịch bản

| Kịch bản | Kiểm tra gì |
|---|---|
| `selfcheck` | Chạy bộ tự kiểm tra của `#/dev` (`?dev=1&autorun=1`): lưu trữ, gộp, sao lưu. In `TẤT CẢ ĐẠT` khi xong. |
| `ui` | Luồng sao lưu thật: nạp dữ liệu mẫu, bấm Sao lưu JSON, xoá DB, khôi phục từ file qua hộp thoại "Thay thế"; file JSON sai bị từ chối. |
| `practice` | Cambridge Practice: ô test, nhập/sửa điểm, band, bộ lọc, test tiếp theo. |
| `practice-t`, `practice-m` | Chụp ảnh Practice ở 900px (iPad) và 390px (điện thoại). Không có PASS/FAIL, xem ảnh. |
| `capture` | Ghi nhanh (phím N, Alt+1/2, Enter/Tab): từ, lỗi, trùng, nguồn mặc định, Vocabulary Bank. |
| `recent` | Nguồn mặc định của ghi nhanh: lần lưu cuối còn hạn (≤3 giờ) hay hết hạn. |
| `capture-m` | Ghi nhanh trên điện thoại 390px (sheet, nút nổi). |
| `grammar` | Grammar Notebook và tab Notebook: danh sách, thẻ lỗi, sửa/khắc phục, dán văn bản, ghi chú liên kết. |
| `grammar-m` | Grammar Notebook trên 390px (ảnh chụp, chip cuộn ngang). |
| `warmup` | Khởi động 15 phút: 4 kiểu bài, chấm Leitner, hộp 5, lỗi, tóm tắt cuối buổi. |
| `warmup-exit` | Thoát giữa buổi, dữ liệu đã chấm vẫn giữ. |
| `warmup-clock` | Hết giờ từng bước (dùng `?dev=1&clock=GIÂY`). |
| `warmup-empty` | Khởi động khi DB rỗng hoặc không có gì đến hạn. |
| `warmup-m` | Khởi động trên 390px. |
| `dashboard` | Dashboard: số khớp các màn khác, thẻ mở đúng bộ lọc, hero đổi sau khi khởi động, hoạt động gần đây, nhắc sao lưu, trạng thái rỗng. |
| `dashboard-m` | Dashboard 390px: lưới 2×2, nút hero một dòng, không tràn ngang. |
| `layout` | Chụp ảnh trang chủ ở 1280, 900 và 390px (`layout-d/t/m.png`). |
| `nodev` | Vào `#/dev` khi không có `?dev=1` thì bị đưa về trang thường. |

Dữ liệu mẫu cho các kịch bản nằm trong `js/dev/sample-data.js`.

## Lưu ý

- Ngôn ngữ giao diện là tiếng Việt, kịch bản tìm theo chữ trên màn hình và selector CSS; đổi chữ hoặc class thì kịch bản có thể phải sửa theo.
- Mỗi kịch bản là một nhánh `if (scenario === ...)` trong `run.mjs`. Thêm kịch bản mới bằng cách thêm nhánh mới.
- Chưa thử trên Safari, thiết bị thật hay thao tác chạm: đây chỉ là Chrome trên máy tính.
