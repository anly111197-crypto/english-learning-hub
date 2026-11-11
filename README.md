# English Learning Hub

Website cá nhân luyện Cambridge IELTS 10–19: khởi động 15 phút, ghi nhanh từ và lỗi, theo dõi điểm, chấm Writing/Speaking với Claude.

## Bắt đầu
1. Tạo repo mới trên GitHub (ví dụ `english-learning-hub`), có thể để public vì repo không chứa dữ liệu hay khoá.
2. Giải nén bộ khởi động này vào repo, rồi commit và push.
3. Mở thư mục bằng Antigravity. Agent sẽ đọc `.agent/rules/elh-project.md` và `docs/spec.md`.
4. Lời nhắn đầu tiên cho agent: *"Đọc docs/spec.md và làm Bước 1 của lộ trình (mục 10). Nêu kế hoạch trước khi code."*
5. Sau Bước 1: Settings → Pages → Deploy from branch `main` / root để có link dùng trên điện thoại.

## Không bao giờ commit
- File PDF/audio/đáp án Cambridge hay bất kỳ tài liệu có bản quyền nào.
- API key, access code, file backup `elh-backup-*.json`.

`.gitignore` đã chặn sẵn các loại file này.
