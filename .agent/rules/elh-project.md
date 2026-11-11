# English Learning Hub: quy tắc cho agent

Đọc `docs/spec.md` trước khi làm bất kỳ việc gì. Spec là nguồn chuẩn; ảnh trong `design/stitch/` chỉ để tham chiếu bố cục.

## Cách làm việc
- Làm đúng **một bước** của lộ trình (spec mục 10) mỗi lần. Trước khi code, nêu kế hoạch ngắn và các file sẽ sửa, rồi chờ người dùng đồng ý.
- Giữ thay đổi nhỏ, mỗi bước một commit với message rõ ràng.
- Trả lời người dùng bằng tiếng Việt. Code, tên biến và comment viết bằng tiếng Anh. Chuỗi hiển thị trên giao diện viết bằng tiếng Việt.
- Không tự thêm tính năng ngoài spec. Gặp chỗ spec chưa rõ thì hỏi, đừng đoán.

## Công nghệ (không được đổi)
- HTML + CSS + JavaScript thuần với ES Modules. **Không** dùng React/Vue/Svelte, TypeScript, bundler, npm build, Tailwind.
- Thư viện bên ngoài duy nhất: `idb` (copy vào `js/vendor/`). Muốn thêm thư viện khác phải hỏi trước.
- Lưu trữ bằng IndexedDB qua `js/services/repo.js`. View không được gọi IndexedDB trực tiếp.
- Mọi lời gọi AI đi qua `js/ai/index.js`. View không biết đang ở chế độ copy/paste hay API.
- Màu, chữ, bo góc lấy từ biến trong `css/tokens.css`. Không hard-code mã màu trong component.

## Bảo mật và bản quyền (bắt buộc)
- **Không bao giờ** đặt API key, access code, token OAuth hay secret vào HTML/JS/CSS, file backup, commit hoặc log. API key chỉ là secret của Cloudflare Worker.
- **Không bao giờ** thêm vào repo: PDF/audio/đáp án/bài đọc Cambridge, hay bất kỳ tài liệu có bản quyền nào. App chỉ lưu metadata {book, test, skill, part}, câu ngữ cảnh ngắn người dùng tự ghi, và link do người dùng tự dán.
- Không tự động hoá NotebookLM / Gemini Notebook (không scraping, không extension, không API không chính thức). Chỉ có link mở ngoài và chức năng dán kết quả thủ công.
- Google Drive chỉ dùng scope `https://www.googleapis.com/auth/drive.appdata`.

## Nội dung giao diện
- Nhãn AI chỉ ghi "Claude", không ghi số phiên bản.
- Không có gamification: XP, điểm thưởng, huy hiệu, chuỗi ngày, "focus score", "milestone".
- Không hiển thị số liệu, nguồn hay nhãn "đã xác minh" mà dữ liệu không có (ví dụ "Cambridge Corpus", "Band 8.0 Model Essay", "34% lỗi"). Mọi con số phải tính được từ IndexedDB.
- Câu ví dụ trong ôn tập phải là câu người dùng đã ghi, kèm nguồn Cam/Test.
- Sửa lỗi Writing/Speaking là **sửa tối thiểu**; diễn đạt nâng cấp chỉ nằm ở tab "Bản Band 7.0+".
- Số, nút, tag dùng `white-space: nowrap`. Nút "Ghi nhanh" (FAB) ẩn khi sheet hoặc modal đang mở.
- Vùng bấm tối thiểu 44px. Bố cục chạy đúng ở 3 mức: ≥1024, 768–1023, <768.

## Kiểm tra trước khi báo xong
- Mở bằng một static server (ví dụ `npx serve .` hoặc `python -m http.server`), không mở bằng `file://`.
- Thử ở khổ desktop và iPhone (DevTools device mode). Console không có lỗi.
- Logic thuần (`bands.js`, `leitner.js`, `next-test.js`, `dedupe.js`) phải có test trong `tests/` chạy được bằng trình duyệt hoặc `node --test`.
- Nói rõ phần nào đã thử, phần nào chưa thử.
