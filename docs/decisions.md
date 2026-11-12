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
| 12/11/2026 | `attempts` Writing có thêm trường `task` (1 hoặc 2); mỗi Task là một attempt, khoá ghi đè là book/test/skill/task. Ô W trên ma trận và "Writing ước tính" = (Task 1 + 2 × Task 2) ÷ 3, làm tròn theo quy tắc 6.1; chỉ có một Task thì hiện band Task đó kèm dấu "*" | **Công thức ước lượng, không phải công thức chính thức** của IELTS; spec chưa quy định cách gộp hai Task |
| 12/11/2026 | "Đã làm một test" = có cả attempt Listening và Reading; cột x/4 và "x/40 test" đếm theo đó | Khớp với `next-test` (spec 6.2); Writing/Speaking chấm riêng |
| 12/11/2026 | Số câu đúng L/R dưới 4 (dưới bảng 6.1) quy ra band 2.0, ghi chú "dưới bảng quy đổi"; overall chỉ hiện khi có ≥2 kỹ năng, ghi "Ước tính (n/4)" khi chưa đủ 4 | Spec 6.1 chưa nói các trường hợp này |
| 12/11/2026 | Link PDF/audio chỉ nhận `https://` (kiểm tra khi lưu và khi hiển thị); mở bằng thẻ `<a target="_blank" rel="noopener noreferrer">` | Tệp backup có thể chứa link lạ; link là của người học |
| 12/11/2026 | Màu chữ trên ô band lấy từ `--on-band-*` (chữ tối trên amber/teal, chữ trắng trên navy) | Chữ trắng trên amber/teal không đạt tương phản AA |
| 12/11/2026 | Lỗi ghi nhanh có câu sai trùng hệt một lỗi đã có (không phân biệt hoa thường, khoảng trắng thừa): tăng `occurrences` thêm 1 và cập nhật `lastSeen` trên thẻ cũ, không tạo thẻ mới, nhưng **vẫn tạo bản ghi `occurrences` mới có nguồn** | Tránh hai thẻ giống hệt; mỗi lần gặp vẫn có lịch sử và nguồn riêng. Spec 6.5 chỉ nói trùng signature |
| 12/11/2026 | Từ ghi nhanh: pos rỗng. Trùng lemma với đúng một thẻ thì chỉ thêm ngữ cảnh (bỏ qua nếu cùng câu và cùng nguồn); trùng lemma với nhiều thẻ khác pos thì hỏi chọn thẻ hoặc tạo thẻ mới; mỗi lần lưu tạo một bản ghi `occurrences` | Spec 6.5 |
| 12/11/2026 | Nguồn mặc định của Ghi nhanh: test của panel đang mở, rồi nguồn lần ghi gần nhất trong phiên, rồi test "Tiếp theo". Có lựa chọn "Không gắn test". Phím N mở lại ở tab dùng gần nhất; Alt+1 / Alt+2 đổi tab; Enter lưu ở mọi ô kể cả select | Ghi liên tiếp nhiều mục cho một test chỉ phải đặt nguồn một lần; ghi bằng bàn phím |
| 12/11/2026 | Xuất CSV từ vựng: UTF-8 có BOM, xuống dòng CRLF, collocations nối bằng "; ", mỗi từ một dòng với ngữ cảnh đầu tiên và nguồn của nó; ô bắt đầu bằng `=`, `+`, `-`, `@` được thêm dấu `'` phía trước. Chọn từ thì xuất các từ đã chọn, không thì xuất toàn bộ danh sách đang lọc | Mở đúng tiếng Việt trong Excel; chặn ô bị hiểu là công thức |
| 12/11/2026 | Gộp hai thẻ từ (khi sửa lemma hoặc pos đụng thẻ khác): giữ thẻ đích, nối ngữ cảnh, collocations, synonyms, điền trường trống từ thẻ kia, lấy hộp thấp hơn và ngày ôn sớm hơn, chuyển `occurrences` sang thẻ đích, thẻ kia xoá mềm; không đổi pos của thẻ đích | Việc "Bước 4 xử lý gộp" đã hẹn ở Bước 2 |
| 12/11/2026 | "Chờ hoàn thiện" nghĩa là `enriched: false` (chờ Claude), kể cả khi người học đã tự điền tay. "Ôn ngay" và "Hoàn thiện với Claude" để disabled kèm ghi chú Bước 5 / Bước 8. Panel từ vựng giữ trạng thái trong trang, không có route riêng | Spec 6.6 và mục 4 |
