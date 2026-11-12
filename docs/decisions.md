# Nhật ký quyết định

| Ngày | Quyết định | Lý do |
|---|---|---|
| 11/11/2026 | Web app tĩnh, JS thuần, IndexedDB, PWA, host GitHub Pages | 1 người dùng, cần mở bằng một link trên Windows, iPad, iPhone, không cần backend |
| 11/11/2026 | Đồng bộ qua Google Drive `drive.appdata`, một file JSON | Đa thiết bị mà không cần server; dữ liệu nằm trong Drive riêng |
| 11/11/2026 | Claude: copy/paste trước (2a), API qua Cloudflare Worker sau (2b) | Dùng AI được ngay; key không bao giờ nằm ở frontend |
| 11/11/2026 | NotebookLM chỉ ở mức thủ công (link + dán kết quả) | Không có API công khai cho bản cá nhân; không dùng automation không chính thức |
| 11/11/2026 | Trọng tâm Cambridge 10–19: khởi động 15' → làm đề → ghi nhanh → nhập điểm | Yêu cầu của người dùng |
| 11/11/2026 | Learning Materials gộp vào Cambridge Practice (tab Notebook & tài liệu); bỏ store `materials` | Nguồn đã nằm trong `source` |
| 11/11/2026 | Giao diện duyệt từ 6 vòng Google Stitch (palette navy #0D233D / teal #18A6A6, Plus Jakarta Sans) | Người dùng duyệt "duyệt giao diện" |
| 11/11/2026 | File PDF/audio Cam của người dùng: giai đoạn 1 lưu link Drive riêng theo từng test; màn luyện đề trong app để sau | Không đưa tài liệu có bản quyền lên host; dùng được trên mọi thiết bị (mặc định, chờ người dùng xác nhận) |
| 11/11/2026 | Sửa lỗi bởi Claude là sửa tối thiểu; nâng cấp diễn đạt tách riêng | Sổ lỗi phải phản ánh đúng lỗi của người học |
| 12/11/2026 | `vocab` có trường `lemmaPos` ("mitigate\|verb", chữ thường, bỏ khoảng trắng thừa) do `repo.js` tự tính mỗi lần ghi, làm unique index; đổi pos/lemma thì tính lại, đụng bản ghi khác thì báo lỗi, không ghi đè (Bước 4 xử lý gộp) | IndexedDB không có unique index trên 2 trường riêng lẻ; pos rỗng cho "mitigate\|" |
| 12/11/2026 | `notes` có trường `linkKeys` ("vocab:<id>") do `repo.js` tự tính, làm multiEntry index thay cho `links` | `links` là mảng object, không dùng làm khoá index được |
| 12/11/2026 | Thêm lại từ/lỗi/notebook đã xoá (tombstone) thì dùng lại id của tombstone | Unique index tính cả bản ghi `deleted`; tránh lỗi trùng và giữ đúng lịch sử sync |
| 12/11/2026 | Import "Thay thế" kiểm tra tệp trước (trùng lemmaPos/signature/group thì báo lỗi, không ghi gì); ghi dữ liệu trong một transaction; tự tải bản sao lưu hiện tại trước khi đổi (bỏ qua khi DB trống) | DB không bao giờ nằm ở trạng thái nửa vời |
| 12/11/2026 | Gộp: `tests` theo `key`; `notebooks` trùng `group` gộp như vocab (updatedAt mới thắng); `mergeData` nằm trong `js/services/merge.js` riêng | Hàm thuần chạy được bằng `node --test` |
