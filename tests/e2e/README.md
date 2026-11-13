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
| `run-listening` | Màn Luyện đề (Bước 6b), Listening trên laptop: 3 nút Luyện ở panel, ẩn nav/FAB, 2 cột, 4×10 ô, khung xem Drive + link tab mới, chọn PDF và 4 audio (tạo giả lúc chạy), thứ tự Part, phím Space/←/→, Enter sang ô kế, tải lại không mất đáp án, tự lưu 5 giây, tạm dừng, nộp, chấm bằng phím 1/2, số ô chưa chấm, Ghi lỗi/từ đúng nguồn, phím N, hỏi ghi đè, lưu attempt, xoá nháp; đồng hồ chỉ chạy khi bấm Bắt đầu / Phát audio lần đầu, tải lại thì tạm dừng, ô ma trận và panel. |
| `run-listening-m` | Luyện đề ở 390px: tab Đề/Phiếu, thanh audio còn khi sang tab Phiếu, không tràn ngang, vùng bấm ≥44px, nộp khi còn ô trống thì hỏi. Có ảnh `run-m-*.png`. |
| `run-clock` | Luyện đề Reading: 3 Passage 13/13/14, đồng hồ 60', hết giờ khoá phiếu, tăng giới hạn thì mở khoá, hỏi khi nộp thiếu, Thoát giữ nháp. |
| `run-writing` | Luyện đề Writing: Task 1/2 và đồng hồ 20'/40', đếm từ và cảnh báo, tự lưu vào `submissions`, tải lại không mất chữ, không tạo bản ghi trùng, Xong → modal band, attempt gắn `submissionId`, bài mới bắt đầu trống. |
| `sync` | Đồng bộ Google Drive (Bước 7) với đăng nhập Google GIẢ và Drive GIẢ chèn vào trang (không gọi Google thật; tệp Drive giả nằm trong localStorage): chưa kết nối thì không popup, Kết nối bằng chuột thật (có user activation), backup tải xuống lần đầu, tạo tệp, token không nằm trong storage/IndexedDB/tệp, kéo, giới hạn 30 giây khi focus, đẩy sau 5 giây, mở lại tự xin token im lặng, bị từ chối thì Cần đăng nhập lại và nút Đăng nhập lại, Offline rồi online, 401, Ngắt kết nối (giữ dữ liệu), kết nối lại không tải backup thứ hai; vòng kéo (rút còn 2 giây bằng `?dev=1&poll=2`): không đổi thì chỉ có yêu cầu `modifiedTime`, có thay đổi từ máy khác thì tự tải, tab ẩn và offline thì không có yêu cầu nào, hiện lại / online thì kịp thay đổi. |
| `sync-m` | Như `sync` nhưng ở 390px: dùng thẻ ở Dashboard, hộp thoại vừa màn hình, có ảnh `sync-m-dialog.png`. |
| `run-capture`, `run-capture-m` | Nút "Ghi nhanh" ở thanh đầu màn Luyện đề (1280px và 390px): vùng bấm ≥44px, nowrap, không tràn ngang; chưa focus ô nào thì part trống; đang làm bài mở bằng chuột thật, lưu 1 từ, nguồn đúng Cam/Test/Part theo ô focus sau cùng, đồng hồ vẫn chạy, đáp án còn, focus quay lại ô cũ; tải lại thì part lại trống (không kế thừa lần lưu trước); lúc chấm vẫn có nút và đúng Part; Khởi động 15' không có nút. |
| `enrich`, `enrich-m` | "Hoàn thiện với Claude" (Bước 8a), 1280px và 390px, JSON mẫu tự dựng (không gọi Claude): ghi 3 từ (2 có câu ngữ cảnh, 1 chỉ có chữ viết sai) + 1 lỗi bằng bàn phím thật; toast có nút; thẻ Dashboard; sao chép (trong click) và ô văn bản khi bị từ chối; nút Dán và gợi ý khi bị từ chối; JSON sai hoặc id lạ thì báo và không lưu gì; duyệt, sửa lemma (kế hoạch gộp đổi theo), tick, chặn lưu khi thiếu nghĩa; lưu: thẻ đủ IPA/nghĩa/collocation, example ở trường riêng, ghi chú chính tả, gộp vào thẻ cũ giữ box 4, occurrences chuyển sang; khởi động dùng được chọn nghĩa/cloze/gõ collocation; Grammar Notebook gộp theo signature. |
| `layout` | Chụp ảnh trang chủ ở 1280, 900 và 390px (`layout-d/t/m.png`). |
| `nodev` | Vào `#/dev` khi không có `?dev=1` thì bị đưa về trang thường. |

Dữ liệu mẫu cho các kịch bản nằm trong `js/dev/sample-data.js`.

## Lưu ý

- Thư mục xuất giữ file tải về giữa các lần chạy: nếu capture báo FAIL  CSV downloaded thì xoá file elh-vocab-*.csv cũ trong thư mục đó rồi chạy lại (Chrome ghi đè file cùng tên nên kịch bản không thấy file mới).

- Các kịch bản `run-*` tự tạo PDF và file audio WAV giả (im lặng) trong một thư mục tạm của hệ điều hành lúc chạy. Không có file đề hay audio nào nằm trong repo.

- Ngôn ngữ giao diện là tiếng Việt, kịch bản tìm theo chữ trên màn hình và selector CSS; đổi chữ hoặc class thì kịch bản có thể phải sửa theo.
- Mỗi kịch bản là một nhánh `if (scenario === ...)` trong `run.mjs`. Thêm kịch bản mới bằng cách thêm nhánh mới.
- Chưa thử trên Safari, thiết bị thật hay thao tác chạm: đây chỉ là Chrome trên máy tính.
