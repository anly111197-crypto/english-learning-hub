# English Learning Hub — Spec kỹ thuật v1.0

Ngày: 11/11/2026 · Trạng thái: giao diện đã duyệt (6 vòng Stitch), chờ duyệt spec trước khi code.
Nguồn gốc: bản thiết kế "Thiết kế English Learning Hub" (Claude Doc) + review Stitch. Khi tài liệu này khác bản thiết kế, **tài liệu này thắng**.

---

## 1. Mục tiêu và phạm vi

Website cá nhân giúp một người học (An Ly) đạt IELTS Academic 6.5–7.0 bằng cách luyện **Cambridge IELTS 10–19**. Website **không chứa đề**, chỉ phục vụ vòng lặp quanh việc làm đề:

```
Khởi động 15' (ôn từ + lỗi đến hạn)
  → Làm Cam X · Test Y (trên sách / PDF / audio riêng của người học)
  → Ghi nhanh từ mới và lỗi trong lúc làm
  → Nhập điểm L/R, chấm W/S với Claude
  → Tiến độ, Vocabulary Bank, Grammar Notebook tự cập nhật
```

**Trong phạm vi:** 5 module (Dashboard, Cambridge Practice, Writing & Speaking AI, Vocabulary Bank, Grammar Notebook), màn Khởi động 15', Ghi nhanh, đồng bộ Google Drive, PWA, sao lưu JSON.

**Ngoài phạm vi (không làm):** tài khoản/backend riêng, lưu hoặc upload đề/audio/đáp án Cambridge, chấm tự động từng câu L/R, gamification (XP, huy hiệu, chuỗi ngày, "focus score"), lịch học tuần, đếm giờ học, chatbot tự do, tự động hoá NotebookLM, SM-2/FSRS, push notification, đa ngôn ngữ.

## 2. Công nghệ

| Hạng mục | Chọn | Ghi chú |
|---|---|---|
| Ngôn ngữ | HTML + CSS + JavaScript thuần, ES Modules | Không framework, không TypeScript, không bước build |
| CSS | CSS thuần với biến (design tokens ở mục 9) | Không dùng Tailwind CDN khi chạy thật; Stitch HTML chỉ là ảnh tham chiếu |
| Lưu trữ | IndexedDB qua thư viện `idb` (vendored trong `js/vendor/`) | LocalStorage chỉ cho cài đặt nhỏ |
| Đồng bộ | Google Drive `drive.appdata`, Google Identity Services | Một file `elh-data.json` |
| Offline | `manifest.json` + `sw.js` (cache app shell) | Add to Home Screen trên iPhone/iPad |
| Host | GitHub Pages (hoặc Cloudflare Pages) | Repo có thể public, vì không chứa dữ liệu hay khoá |
| AI | Claude: Phase 2a copy/paste, Phase 2b API qua Cloudflare Worker | Không bao giờ có API key trong frontend |
| Font | Plus Jakarta Sans (Google Fonts) + fallback hệ thống | |

## 3. Cấu trúc thư mục

```
index.html                  # app shell: sidebar / bottom tabs, <main id="view">, FAB Ghi nhanh
manifest.json  sw.js
assets/icons/               # icon PWA
css/
  tokens.css                # biến màu, chữ, bo góc, khoảng cách (mục 9)
  base.css  layout.css  components.css
js/
  app.js                    # khởi động, đăng ký route, khởi tạo sync
  router.js                 # hash router
  state.js                  # trạng thái phiên (buổi luyện đang mở, test đang xem)
  views/
    dashboard.js  practice.js  practice-notebooks.js
    warmup.js  writing.js  speaking.js  vocab.js  errors.js
  components/
    quick-capture.js  sheet.js (drawer/bottom sheet)  modal.js
    band-cell.js  toast.js  highlight.js
  services/
    db.js                   # mở IndexedDB, migration theo schemaVersion
    repo.js                 # CRUD chung: id, createdAt, updatedAt, deleted
    dedupe.js               # lemma+pos, signature
    leitner.js              # hộp, lịch ôn, chọn thẻ cho khởi động
    bands.js                # bảng quy đổi L/R, làm tròn overall
    next-test.js            # chọn "buổi luyện tiếp theo"
    backup.js               # export/import JSON
    sync-drive.js           # GIS + Drive appdata
  ai/
    schema.js               # JSON Schema các tác vụ
    prompts.js              # ghép prompt
    adapter-manual.js       # copy/paste
    adapter-api.js          # gọi proxy (Phase 2b)
    index.js                # ai.run(task, input) chọn adapter theo cài đặt
  vendor/idb.js
worker/                     # Cloudflare Worker proxy (Phase 2b), deploy riêng
docs/  spec.md  decisions.md
design/stitch/              # export Stitch: ảnh + HTML tham chiếu, KHÔNG import vào app
```

## 4. Điều hướng

| Route | Màn | Desktop ≥1024 | iPad 768–1023 | iPhone <768 |
|---|---|---|---|---|
| `#/` | Dashboard | sidebar 260px có nhãn | sidebar 72px chỉ icon | thanh tab đáy 5 mục |
| `#/practice` | Cambridge Practice · Tiến độ | | | |
| `#/practice/notebooks` | Cambridge Practice · Notebook & tài liệu | | | |
| `#/practice/:book/:test` | mở panel chi tiết test | drawer phải dạng overlay | drawer | bottom sheet |
| `#/practice/:book/:test/:skill` | Luyện đề trong app, `skill` = L \| R \| W (toàn màn, ẩn sidebar và FAB; mục 5.9) | 2 cột | tab Đề \| Phiếu | tab Đề \| Phiếu |
| `#/warmup` | Khởi động 15' (toàn màn, ẩn sidebar) | | | |
| `#/ai/writing`, `#/ai/speaking` | Writing & Speaking AI | 2 cột | 1–2 cột | 1 cột |
| `#/vocab` | Vocabulary Bank | bảng + panel | bảng + panel overlay | thẻ + bottom sheet |
| `#/errors` | Grammar Notebook | danh sách + cột bài tập | | |

Tab đáy iPhone: Dashboard · Cambridge · AI · Từ vựng · Lỗi. Vùng bấm tối thiểu 44px.

## 5. Màn hình (chốt từ Stitch, kèm các sửa bắt buộc)

Ảnh tham chiếu ở `design/stitch/<tên-màn>/screen.png`. Code theo ảnh nhưng **áp các sửa trong cột "Bắt buộc sửa"**.

### 5.1 Dashboard
- Hero: "Buổi luyện tiếp theo: Cam 15 · Test 3", nhãn "Đến hạn ôn: 18 từ · 5 lỗi", nút chính **Bắt đầu buổi luyện (khởi động 15 phút)** → `#/warmup`.
- 4 thẻ số: Tiến độ Cam 10–19 (x/40 test), Band trung bình (overall + L/R/W/S, mục tiêu 7.0), Từ vựng đã lưu (+ số đến hạn), Lỗi cần khắc phục (+ nhóm nhiều nhất).
- Hoạt động gần đây: 5 mục cuối (attempt, submission).
- **Bắt buộc sửa:** bỏ nút "Thêm nhanh" trên header (đã có FAB); nhãn AI chỉ ghi "Claude"; số liệu `whitespace: nowrap`; ví dụ mẫu Reading 32/40 = **7.0**. Mobile: hero ghi buổi tiếp theo, không có thẻ "Chuỗi ngày".

### 5.2 Cambridge Practice · Tiến độ
- 4 thẻ tóm tắt (giống Dashboard nhưng theo test).
- Ma trận Cam 19 → Cam 10 × Test 1–4, mỗi ô test có 4 ô con L/R/W/S tô theo band: chưa làm (xám), <6.0 (cam), 6.0–6.5 (navy), ≥7.0 (teal). Ô "Đang xem" viền liền, ô "Tiếp theo" viền đứt. Cột cuối: x/4 test.
- Lọc: Tất cả / Chưa làm / Cần cải thiện (<6.5); kỹ năng L/R/W/S.
- Bấm ô → panel chi tiết **overlay** (không đẩy ma trận): 4 kỹ năng với điểm, ngày, phút, nút Sửa; Writing có "Xem bài sửa (Claude)"; danh sách từ và lỗi của test; nút "+ Ghi nhanh cho test này"; **nút Mở đề PDF / Mở audio** (mục 6.10); ba nút **Luyện Listening / Reading / Writing** mở màn Luyện đề (mục 5.9).
- Modal Nhập kết quả: tab Listening/Reading, số câu đúng /40 → tự hiện band; ngày; phút; ghi chú.
- **Bắt buộc sửa:** bỏ tag "Academic Edition", bỏ banner "Đang xem" ở đáy, nhãn "Claude".

### 5.3 Cambridge Practice · Notebook & tài liệu
- Lưới 2 cột thẻ notebook (6 nhóm: Writing, Speaking, Vocabulary, Grammar, Cambridge Practice, Professional English): tên, mô tả, số nguồn (người dùng tự nhập), nút **Mở trong NotebookLM** (link ngoài).
- Nút **Dán kết quả từ NotebookLM** → modal dán, tách KIẾN THỨC / VÍ DỤ / NGUỒN thành note, gắn vào test/từ/lỗi.
- **Bắt buộc sửa:** không có "Đồng bộ nguồn", không có nhãn "NotebookLM Sync". Ghi "NotebookLM / Gemini Notebook".

### 5.4 Ghi nhanh (FAB, phím tắt `N`)
- Hai tab **Từ mới / Lỗi sai**. Từ mới: từ/collocation (bắt buộc) + câu ngữ cảnh. Lỗi sai: câu sai (bắt buộc) + câu đúng nếu biết.
- Nguồn tự điền {book, test, skill, part} theo test đang mở; sửa được bằng 4 select.
- Lưu bằng Enter, đóng ngay, toast "Đã lưu · N mục chờ Claude hoàn thiện" + nút "Hoàn thiện với Claude".
- **Bắt buộc sửa:** ô ngữ cảnh tự giãn chiều cao; FAB **ẩn khi bất kỳ sheet/modal nào đang mở**.

### 5.5 Khởi động 15'
Header cố định: Thoát · stepper **1. Từ vựng (10') / 2. Ngữ pháp (5')** (tô đúng bước hiện tại) · đồng hồ đếm ngược · tiến độ (`7/18` ở bước 1, `2/5` ở bước 2) · Bỏ qua.

Bước 1 — 4 dạng bài theo hộp Leitner (mục 6.3):
| Hộp | Dạng | Tương tác |
|---|---|---|
| 1–2 | Flashcard | lật (Space), Quên / Nhớ mơ hồ / Nhớ rõ (phím 1/2/3) |
| 3 | Chọn nghĩa đúng trong ngữ cảnh | 4 đáp án nghĩa tiếng Việt, 3 nhiễu lấy từ nghĩa của từ khác trong kho |
| 4 | Điền từ vào câu ngữ cảnh | ô gõ, gợi ý chữ cái đầu + số ký tự, nút "Gợi ý thêm chữ cái", "Tôi chưa nhớ từ này" |
| 5 | Gõ collocation từ nghĩa tiếng Việt | ô gõ, so khớp không phân biệt hoa thường, bỏ khoảng trắng thừa |

Bước 2 — 5 lỗi: hiện câu sai (gạch đỏ phần sai) + nhãn loại lỗi ×số lần; ô "Viết lại câu đúng"; nút Xem đáp án → câu đúng + giải thích tiếng Việt; tự chấm **Sai / Đúng**.

Tổng kết: số từ nhớ (x/y), số lỗi sửa đúng (x/5), danh sách từ trả lời sai, lỗi cần lưu ý; nút **Vào luyện Cam X · Test Y** + Về Dashboard.

**Bắt buộc sửa:** khi trả lời sai hiện "Sai · từ này quay lại hộp 1", không hiện "Chính xác!"; bỏ XP, "Focus score", "Cadence activated", "Cambridge Corpus", "Audio & Context Verified", số liệu không có trong dữ liệu; câu ví dụ luôn là **câu người học đã ghi** + nguồn Cam/Test; màn tổng kết chỉ một header.

### 5.6 Writing & Speaking AI
- Thanh chọn nguồn: Cam X · Test Y · Task 1/2 (hoặc Part 1/2/3), dạng bài.
- Trái: đề bài (người học tự gõ/dán đề từ sách của mình — chỉ lưu cục bộ), bài viết, đếm từ, đồng hồ 20/40', nút **Phân tích với Claude**; khối "Chấm thủ công (copy/paste)": Sao chép prompt · ô dán JSON · Đọc JSON.
- Phải: band tổng + 4 tiêu chí kèm nhận xét ngắn; 3 chế độ xem **Bài gốc có highlight / So sánh gốc–sửa / Bản Band 7.0+**; popover lỗi có "Lưu lỗi vào sổ tay".
- Dưới: 2 khay **Lỗi phát hiện** và **Từ vựng nên học** có checkbox, nhãn "Mới" / "Đã có · lần N"; thanh đáy "Lưu đã chọn (N mục)".
- Lưu xong: band Writing/Speaking ghi vào ô tương ứng của ma trận.
- **Bắt buộc sửa:** nhãn "Claude"; bỏ "Chuẩn Cambridge IELTS 2024"; tab So sánh chỉ hiện **sửa tối thiểu** (mục 7.3), cách diễn đạt nâng cấp chỉ ở tab Band 7.0+.

### 5.7 Vocabulary Bank
- Thanh: tìm kiếm, tổng từ · đến hạn · chờ Claude điền; nút + Thêm từ, **Ôn ngay (N đến hạn)**.
- Lọc: nguồn (Cam 19…10, Writing, Speaking), chủ đề, hộp Leitner H1–H5.
- Bảng: checkbox, từ (+ nút nghe bằng Web Speech `speechSynthesis`), nghĩa, nguồn, hộp, lần ôn tới. Không có cột phiên âm.
- Panel chi tiết: từ, IPA, loại từ, chủ đề, nghĩa VI + định nghĩa EN, collocations (đánh dấu số lần gặp), từ đồng nghĩa, **ngữ cảnh đã ghi** (kèm nguồn), "Xuất hiện trong" (test, bài viết, khởi động), hộp Leitner + lần ôn gần nhất.
- Thanh hàng loạt: Hoàn thiện N từ với Claude · Xuất Anki/CSV · Đánh dấu đã thuộc (→ hộp 5).
- **Bắt buộc sửa:** nhãn "Claude"; bỏ "C1–C2 Academic Lexicon"; không có câu ví dụ gắn nguồn bịa ("Model Essay"); placeholder tiếng Việt.

### 5.8 Grammar Notebook
- 4 thẻ: tổng lỗi, nhóm nhiều nhất, đã khắc phục (tỷ lệ), lặp lại báo động (≥3 lần trong 14 ngày).
- Chip 10 nhóm kèm số; lọc trạng thái Mới / Đang luyện / Đã khắc phục / Lặp lại; sắp xếp theo số lần lặp hoặc gần nhất.
- Thẻ lỗi: ×N, nhóm, trạng thái, nguồn + ngày; câu sai → câu đúng; mở rộng: quy tắc tiếng Việt, ví dụ đúng, lịch sử các lần gặp (link về test/bài viết/khởi động).
- Cột phải: bài tập Claude tạo từ lỗi đã chọn (điền/sửa/viết lại), chấm, đề xuất "Đánh dấu đã khắc phục".
- **Bắt buộc sửa:** bỏ "GRA Milestone Achieved", "Ví dụ chuẩn Band 8.0+", "Trí tuệ nhân tạo Claude".

### 5.9 Luyện đề trong app
Mở từ panel test (mục 5.2) bằng ba nút **Luyện Listening / Reading / Writing**, route `#/practice/:book/:test/:skill`. Toàn màn: ẩn sidebar và FAB, phím `N` vẫn mở Ghi nhanh. Nút **← Thoát** về panel test.
- **Bố cục:** ≥1024px hai cột (trái: đề, phải: phiếu trả lời hoặc ô viết); <1024px hai tab **Đề | Phiếu**. Thanh audio (Listening) nằm trên cả hai tab.
- **Nguồn đề, hai cách** (tab chọn nguồn ở cột Đề):
  - *File trên máy:* `<input type=file>` nhận một PDF và nhiều file audio (iPad chọn được từ Tệp / Google Drive). File chỉ được đọc trong phiên bằng `URL.createObjectURL`, **không** lưu vào IndexedDB hay localStorage, không đồng bộ, không gửi đi đâu; chỉ nhớ **tên file** để gợi ý lần sau. PDF xem bằng trình xem PDF của trình duyệt (không thêm thư viện).
  - *Link Drive đã lưu* (mục 6.10): nhúng khung xem `https://drive.google.com/file/d/ID/preview`. Không phát hiện được khung bị chặn (Safari), nên luôn có dòng hướng dẫn chuyển sang file trên máy.
  - Nút **Mở PDF trong tab mới** luôn có (file trên máy hoặc link Drive).
- **Audio** (chỉ file trên máy): trình phát HTML5; 2–4 file xếp theo tên (số tự nhiên) thành Part 1–4, chọn bằng một ô select; nút −5s / Phát / +5s; phím Space phát/dừng, ←/→ tua 5s, chỉ khi không đang gõ trong ô, select hoặc khi chưa có sheet/modal mở.
- **Đồng hồ:** Listening 30', Reading 60', Writing Task 1 20' / Task 2 40'; ô "Giới hạn" chỉnh được. Đồng hồ **chỉ chạy khi bấm Bắt đầu** (hoặc khi bấm Phát audio lần đầu); có Tạm dừng / Tiếp tục. Tải lại trang thì đồng hồ ở trạng thái tạm dừng, bấm Tiếp tục mới chạy. Hết giờ: khoá phiếu / ô viết và hiện "Hết giờ" (tăng giới hạn thì mở khoá lại); vẫn nộp bài và chấm được.
- **Phiếu L/R:** 40 ô nhóm theo Part (Listening 1–10, 11–20, 21–30, 31–40) hoặc Passage (Reading 1–13, 14–26, 27–40); Enter / Tab sang ô kế. Nháp (đáp án, thời gian đã dùng, giới hạn) tự lưu mỗi 5 giây và khi rời trang, lưu ở localStorage theo khoá `book-test-skill`; tải lại không mất; xoá sau khi lưu attempt thành công.
- **Ghi nhanh trên thanh đầu** (cạnh đồng hồ, có cả lúc làm bài lẫn lúc chấm; vùng bấm ≥ 44px, nowrap): dành cho iPad và điện thoại không có phím N. Nguồn tự điền {book, test, skill} của bài đang làm và part suy ra từ ô đáp án (hoặc dòng chấm) được focus sau cùng; chưa focus ô nào thì part để trống (không lấy từ lần lưu trước). Mở Ghi nhanh không dừng đồng hồ, không đụng tới đáp án; đóng sheet thì focus quay lại ô cũ. Khởi động 15' không có nút này.
- **Nộp bài → chế độ chấm:** mỗi ô có Đúng / Sai (phím 1 / 2 khi đang chọn một dòng; bấm xong nhảy sang dòng kế). Người học tự dò đáp án trong đề của họ; app không có đáp án. Cạnh nút **Lưu điểm** luôn hiện "Đúng x/40 · Còn n ô chưa chấm" (ô chưa chấm tính là sai). Lưu điểm = quy đổi band bằng `bands.js`, ghi attempt (rawScore, band, durationMin, date) cùng quy tắc với modal Nhập kết quả (mục 5.2: một attempt cho mỗi test và kỹ năng, đã có điểm thì hỏi xác nhận ghi đè), rồi mở lại panel test. Câu sai có nút **Ghi lỗi/từ** mở Ghi nhanh với nguồn {book, test, skill, part} của đúng câu đó.
- **Writing:** chọn Task 1 / Task 2; ô đề bài (người học tự gõ hoặc dán, chỉ lưu trên máy); ô viết có đếm từ, cảnh báo dưới 150 (Task 1) / 250 (Task 2). Tự lưu nháp vào `submissions` (`status: draft`, `source: {book, test, task}`), kèm một bản sao văn bản cạnh đồng hồ ở localStorage để tải lại không mất. **Xong** lưu bài (`doneAt`, status vẫn `draft` cho tới khi Claude chấm ở Bước 8b) rồi mở modal Nhập kết quả để nhập band tay; attempt Writing gắn `submissionId`.
- **Bản quyền:** không có nội dung đề, đáp án, PDF hay audio trong dữ liệu hay repo. Dữ liệu duy nhất là đáp án người học gõ.

## 6. Quy tắc nghiệp vụ

### 6.1 Quy đổi band Listening / Reading (Academic)
| Band | Listening (/40) | Reading Academic (/40) |
|---|---|---|
| 9.0 | 39–40 | 39–40 |
| 8.5 | 37–38 | 37–38 |
| 8.0 | 35–36 | 35–36 |
| 7.5 | 32–34 | 33–34 |
| 7.0 | 30–31 | 30–32 |
| 6.5 | 26–29 | 27–29 |
| 6.0 | 23–25 | 23–26 |
| 5.5 | 18–22 | 19–22 |
| 5.0 | 16–17 | 15–18 |
| 4.5 | 13–15 | 13–14 |
| 4.0 | 10–12 | 10–12 |
| 3.5 | 8–9 | 8–9 |
| 3.0 | 6–7 | 6–7 |
| 2.5 | 4–5 | 4–5 |

Bảng là ước lượng phổ biến; Cambridge điều chỉnh nhẹ theo từng đề. Đặt trong `services/bands.js`, có unit test cho mọi mốc.

**Overall** = trung bình 4 kỹ năng, làm tròn: phần lẻ < .25 → xuống .0; .25–<.75 → .5; ≥ .75 → lên số nguyên. Chỉ tính khi đủ 4 kỹ năng; thiếu thì hiện "Ước tính (3/4 kỹ năng)".

### 6.2 Buổi luyện tiếp theo (`next-test.js`)
1. Nếu người học đã ghim một test → dùng test đó.
2. Ngược lại: lấy cuốn của attempt gần nhất; test nhỏ nhất trong cuốn đó còn thiếu L hoặc R.
3. Cuốn đã đủ → cuốn kế tiếp theo thứ tự người học đã chọn (mặc định Cam 10 → 19).
Ô "Tiếp theo" trên ma trận và nút ở tổng kết khởi động dùng cùng hàm này.

### 6.3 Leitner 5 hộp
- Khoảng ôn: hộp 1 = 1 ngày, 2 = 3, 3 = 7, 4 = 14, 5 = 30.
- Nhớ rõ / trả lời đúng → lên 1 hộp (tối đa 5). Nhớ mơ hồ → giữ hộp, ôn lại sau 1 ngày. Quên / sai → **về hộp 1**.
- Từ mới lưu vào hộp 1, `nextReview` = ngày mai.
- Chọn thẻ cho khởi động: `nextReview ≤ hôm nay`, ưu tiên (1) từ ghi trong 3 buổi gần nhất, (2) số lần quên nhiều, (3) quá hạn lâu nhất. Tối đa 20 thẻ, dừng khi hết 10 phút.
- Dạng bài cần dữ liệu: hộp 3 cần ≥3 từ khác có nghĩa; hộp 4 cần câu ngữ cảnh; hộp 5 cần collocation. Thiếu dữ liệu thì lùi về dạng thấp hơn.

### 6.4 Chọn 5 lỗi cho khởi động
Trạng thái ≠ Đã khắc phục, sắp xếp `occurrences` giảm dần rồi `lastSeen` mới nhất. Tự chấm Đúng 3 lần liên tiếp (qua các buổi) → đề xuất "Đánh dấu đã khắc phục". Lỗi đã khắc phục xuất hiện lại trong bài viết mới → **Lặp lại**.

### 6.5 Chống trùng
- Từ: khoá `lemma + pos` (chữ thường, bỏ khoảng trắng thừa). Trùng → thêm ngữ cảnh mới vào `contexts[]`, không tạo thẻ mới; Ghi nhanh chưa có pos thì khớp theo lemma, hỏi gộp khi có nhiều pos.
- Lỗi: khoá `signature` = `nhóm:quy-tắc` do Claude gán từ danh mục cố định (ví dụ `articles:zero-article-uncountable`, `collocation:make-research→do-research`). Trùng → `occurrences + 1`, `lastSeen`, thêm bản ghi `occurrences`. Lỗi ghi tay chưa có signature → `pending:<id>` cho đến khi Claude hoàn thiện.

### 6.6 Ghi nhanh và "Hoàn thiện với Claude"
Mục ghi nhanh có `enriched: false`. Nút hoàn thiện gom tối đa 20 mục vào một tác vụ `vocab_enrich` / `error_enrich`, kết quả hiện để duyệt, người học tick rồi lưu. Sau khi có signature, chạy lại chống trùng.

**Bước 8a (chế độ copy/paste):** nút "Hoàn thiện với Claude (N)" ở Vocabulary Bank (cả trong thanh chọn nhiều ô), Grammar Notebook, thẻ trên Dashboard (chỉ khi có mục chờ) và trong toast sau khi ghi nhanh. Mỗi lần tối đa 20 mục, cũ nhất trước; từ và lỗi là hai tác vụ riêng. Luồng: Sao chép prompt (gọi clipboard ngay trong click; không chép được thì hiện ô văn bản đã chọn sẵn) → Mở Claude (`claude.ai/new`) → dán JSON (có nút Dán) → bảng duyệt từng mục (sửa được, có checkbox) → "Lưu đã chọn (N)".
- Chỉ gửi cho Claude những gì người học gõ: từ, câu ngữ cảnh họ ghi (câu mới nhất), câu sai, danh sách signature hiện có. Không gửi Cam/Test hay tiến độ Leitner.
- JSON sai (không đọc được, sai `task`, id không khớp hoặc lặp, thiếu trường, `type` ngoài 10 nhóm, signature không bắt đầu bằng `type:`) thì báo bằng tiếng Việt và **không lưu gì**. Mục Claude bỏ sót vẫn chờ hoàn thiện.
- `noteVi` (tuỳ chọn): Claude ghi chú khi từ có vẻ gõ sai chính tả và đề xuất từ đúng ở `lemma`; bảng duyệt hiện ghi chú nổi bật, lemma sửa được, và thẻ lấy từ đúng làm `word`.
- `example` và `wordFamily` của Claude lưu ở trường riêng của thẻ từ (`exampleEn`, `wordFamily[]`), chỉ để đọc; không bao giờ vào `contexts[]` nên không xuất hiện trong bài cloze của khởi động (câu ví dụ phải là câu người học đã ghi).
- Collocations và họ từ của Claude được thêm vào những gì thẻ đang có, không thay thế.
- Chống trùng sau khi hoàn thiện: nếu `lemma + pos` mới trùng một thẻ khác, thẻ vừa hoàn thiện gộp vào thẻ có sẵn (gộp `contexts`, `collocations`; chuyển `occurrences` và liên kết notebook), thẻ có sẵn giữ nguyên box, `nextReview` và `lapses`. Nếu `signature` trùng một lỗi có sẵn thì gộp vào lỗi đó và cộng `occurrences`. Khoá trùng một thẻ đã xoá thì dùng lại danh tính của thẻ đã xoá.

### 6.7 Mười nhóm lỗi
Tenses · Articles · Prepositions · Subject-Verb Agreement · Passive Voice · Word Forms · Sentence Structure · Collocations · Plurals & Countability · Punctuation & Spelling.

### 6.8 Số liệu
Mọi con số trên Dashboard và thẻ tóm tắt tính lại từ bảng khi mở màn, không lưu riêng. Không hiển thị số liệu không tính được từ dữ liệu.

### 6.9 Bản quyền
App không lưu toàn văn đề, audio, đáp án hay bài đọc. Chỉ lưu: metadata {book, test, skill, part}, câu ngữ cảnh ngắn người học tự ghi, đề Writing/Speaking người học tự gõ (chỉ trên máy và Drive riêng), link do người học dán.

### 6.10 File PDF / audio Cam 10–19 của người học
- **Giai đoạn 1 (mặc định):** bảng `tests` lưu link do người học dán: `pdfUrl`, `audioUrls[]` (thường là link file trong Google Drive riêng, chế độ riêng tư). Panel chi tiết test có nút **Mở đề PDF** và **Mở audio Part 1–4** (mở tab mới / app Drive). Có màn "Cài link nhanh" để dán link cho nhiều test.
- **Giai đoạn 2 (Bước 6b, đã duyệt):** màn Luyện đề trong app (mục 5.9): chọn file PDF/audio từ máy bằng `<input type=file>` hoặc dùng khung xem Drive từ link đã lưu, xem PDF bằng trình xem của trình duyệt, phát audio có tua ±5s, đồng hồ, phiếu 40 ô, tự chấm Đúng/Sai. File chỉ đọc trong phiên, không lưu vào IndexedDB, không đồng bộ. Service worker không cache `blob:` và `drive.google.com`.
- Tuyệt đối không commit PDF/MP3 vào repo hay đưa lên host.

## 7. Dữ liệu

### 7.1 IndexedDB `elh`, `schemaVersion: 2`
Mọi bản ghi: `id` (UUID), `createdAt`, `updatedAt`, `deleted` (tombstone cho sync).

| Store | Trường chính | Index / khoá duy nhất |
|---|---|---|
| `vocab` | word, lemma, pos, ipa, meaningVi, definitionEn, topic, collocations[], synonyms[], contexts[] {sentence, source, date}, box (1–5), nextReview, lapses, lastReviewedAt, enriched | **unique** lemma+pos; idx nextReview, box, topic |
| `errors` | signature, type (10 nhóm), original, corrected, explanationVi, correctExample, occurrences, firstSeen, lastSeen, status (new/practicing/fixed/recurring), warmupStreak, enriched | **unique** signature; idx type, status, occurrences |
| `occurrences` | itemType (vocab/error), itemId, source {book,test,skill,part}, submissionId?, sessionId?, sentence, date | idx itemId, submissionId |
| `attempts` | book (10–19), test (1–4), skill (L/R/W/S), date, rawScore?, band, durationMin, note, submissionId? | idx [book,test], skill |
| `tests` | key "15-3", book, test, pdfUrl, audioUrls[], pinned, note | key |
| `submissions` | kind (writing/speaking), source {book,test,task/part}, taskType, prompt, text, wordCount, durationSec, status (draft/analyzed), result (JSON Claude), bands {overall,c1..c4}, aiMode | idx kind, createdAt |
| `sessions` | date, warmup {vocabTotal, vocabCorrect, errorsTotal, errorsCorrect, wrongVocabIds[]}, attemptIds[] | idx date |
| `exercises` | errorIds[], items[] {kind, question, answer, userAnswer, correct}, score, doneAt | idx errorIds (multiEntry) |
| `notebooks` | group (6 nhóm), name, notebookUrl, sourceCount, purpose | **unique** group |
| `notes` | text, example, citation, origin (notebooklm/manual), links[] {type, id} | idx links (multiEntry) |

So với bản thiết kế: bỏ `materials` (Learning Materials đã gộp vào Cambridge Practice, nguồn đã có trong `source`); thêm `attempts`, `tests`, `sessions`; `vocab.examples` đổi thành `contexts[]` có nguồn.

`submissions` bổ sung: `doneAt` (bài Writing đã bấm Xong; `status` vẫn `draft` cho tới khi Claude chấm), `source.task` (1 hoặc 2). `attempts.submissionId` trỏ tới bài Writing đã viết trong màn Luyện đề.

LocalStorage: nháp Luyện đề `elh.run.<book>-<test>-<skill>` (Writing thêm `-<task>`) và tên file đã chọn `elh.runFiles.<book>-<test>` (chỉ tên, không có file), theme, aiMode (manual/api), proxyUrl, accessCode (Phase 2b), lastBackupAt, bookOrder.

### 7.2 Backup / Drive
File `elh-data.json` (Drive appDataFolder) và `elh-backup-YYYY-MM-DD.json` cùng định dạng:
```json
{ "app": "english-learning-hub", "schemaVersion": 2, "exportedAt": "...",
  "data": { "vocab": [], "errors": [], "occurrences": [], "attempts": [], "tests": [],
            "submissions": [], "sessions": [], "exercises": [], "notebooks": [], "notes": [] } }
```
- Gộp: theo `id`, bản `updatedAt` mới hơn thắng; trùng khoá duy nhất (lemma+pos, signature) → gộp, cộng `occurrences`, nối `contexts`.
- Xoá = `deleted: true`; dọn tombstone cũ hơn 90 ngày.
- Đồng bộ (Bước 7, `js/services/sync-drive.js`): mỗi vòng là kéo bản Drive → `validateBackup` → `mergeData` → ghi vào IndexedDB (một transaction, và chỉ khi dữ liệu máy không đổi từ lúc đọc, nếu đổi thì làm lại) → đẩy lên Drive nếu bản gộp khác bản Drive. Không bao giờ ghi đè mù; tệp Drive hỏng hoặc có schemaVersion mới hơn thì dừng, không ghi gì. Lỗi mạng hoặc 401 không đụng dữ liệu trên máy.
- Lịch: kéo khi mở app và khi tab được focus lại (tối đa 1 lần mỗi 30 giây); đẩy sau 5 giây không có thay đổi (`elh:data-changed`, ngoài ra kiểm tra bản ghi mới hơn lần đồng bộ cuối khi đổi trang hoặc rời tab). Hai tab: `navigator.locks` để một vòng chạy một lúc.
- Lần đầu trên mỗi máy: tải xuống một backup JSON của dữ liệu hiện có, rồi GỘP (không thay thế) với Drive.
- Đăng nhập: Google Identity Services, token model, chỉ scope `drive.appdata`, Client ID ở `js/config.js` (công khai, không có client secret). Access token chỉ nằm trong bộ nhớ. LocalStorage chỉ giữ cờ `elh.sync.connected`, `elh.sync.firstBackup`, `elh.sync.lastSyncAt`. Mở app có cờ thì nạp sẵn script GIS và xin token im lặng; không được thì "Cần đăng nhập lại" kèm nút (Safari iOS chỉ cho popup khi người dùng bấm, nên `requestAccessToken` được gọi thẳng trong sự kiện click). Chưa từng kết nối thì không nạp script, không bật popup.
- Trạng thái ở chân sidebar (điện thoại: thẻ ở Dashboard): Đã đồng bộ · x phút trước / Đang đồng bộ / Offline / Cần đăng nhập lại (chưa kết nối: Chưa kết nối Drive). Bấm vào dòng đó mở hộp thoại Kết nối Google Drive / Đồng bộ ngay / Ngắt kết nối (ngắt chỉ xoá cờ và thu hồi token, không xoá dữ liệu trên máy lẫn trên Drive).
- Service worker không cache `accounts.google.com`, `*.googleapis.com`, `*.gstatic.com`.
- Import tự tạo backup hiện tại trước; có 2 chế độ Thay thế / Gộp.
- File không bao giờ chứa API key hay access code.

### 7.3 Hợp đồng JSON với Claude
Tác vụ: `writing_task1`, `writing_task2`, `speaking`, `vocab_enrich`, `error_enrich`, `exercise_generate`, `exercise_grade`. Schema đặt trong `js/ai/schema.js` và dùng chung cho chế độ copy/paste lẫn API.

Ví dụ `writing_task2`:
```json
{
  "schemaVersion": 1, "task": "writing_task2",
  "bands": { "overall": 6.0, "TR": 6.0, "CC": 6.5, "LR": 6.0, "GRA": 5.5 },
  "criteriaFeedbackVi": { "TR": "...", "CC": "...", "LR": "...", "GRA": "..." },
  "errors": [
    { "original": "the technology has changed", "corrected": "technology has changed",
      "start": 112, "end": 138, "type": "articles",
      "signature": "articles:zero-article-uncountable",
      "explanationVi": "...", "correctExample": "...", "severity": "high" }
  ],
  "minimalCorrectedText": "...",
  "band7Text": "...",
  "vocabularySuggestions": [
    { "word": "mitigate", "lemma": "mitigate", "pos": "verb", "ipa": "/ˈmɪtɪɡeɪt/",
      "meaningVi": "...", "collocations": ["mitigate the impact"], "example": "..." }
  ]
}
```
Tác vụ enrich (Bước 8a), cùng khung `{ "schemaVersion": 1, "task": ..., "items": [...] }`, mỗi mục giữ nguyên `id` đã gửi:
```json
// vocab_enrich
{ "id": "...", "lemma": "mitigate", "pos": "verb", "ipa": "/ˈmɪtɪɡeɪt/", "meaningVi": "giảm nhẹ",
  "collocations": ["mitigate the impact"], "example": "...", "wordFamily": ["mitigation (n)"], "noteVi": "(tuỳ chọn) ..." }
// error_enrich
{ "id": "...", "type": "articles", "signature": "articles:zero-article-uncountable", "corrected": "...",
  "explanationVi": "...", "correctExample": "..." }
```
`pos` thuộc noun, verb, adjective, adverb, phrase, other. `type` thuộc 10 nhóm (mục 6.7, dạng slug); `signature` bắt đầu bằng `type:`. Kiểm tra ở `js/ai/schema.js`, prompt ở `js/ai/prompts.js`, cửa duy nhất cho view là `js/ai/index.js`.

Quy tắc cho prompt:
- `corrected` và `minimalCorrectedText` là **sửa tối thiểu**: chỉ sửa lỗi, giữ nguyên ý và từ của người học. Nâng cấp diễn đạt chỉ đặt trong `band7Text`.
- `signature` chọn từ danh sách signature đã có (website gửi kèm), chỉ tạo mới khi không khớp.
- Không bịa nguồn, không trích dẫn "bài mẫu Band 8.0" nếu không có thật.
- Giải thích bằng tiếng Việt, thuật ngữ tiếng Anh giữ nguyên.
- Highlight: website tìm lại vị trí theo `original` nếu `start/end` lệch.

## 8. Claude API (Phase 2b)
- Cloudflare Worker trong `worker/`, secret `ANTHROPIC_API_KEY`. CORS chỉ cho domain của site; header `X-Access-Code` khớp secret; giới hạn request/ngày; chỉ nhận các `task` trong danh sách; system prompt nằm ở Worker.
- Messages API, model `claude-opus-5-5`, structured outputs với schema 7.3, prompt caching cho phần hướng dẫn cố định, effort medium cho chấm bài và low cho enrich.
- Lỗi mạng / hết hạn mức → giữ bản nháp, đề nghị chuyển sang copy/paste cho bài đó.

## 9. Design tokens (nguồn chuẩn)
```css
:root {
  --navy-900: #0D233D;  --navy-700: #17365D;   /* sidebar, nút chính tối */
  --teal-500: #18A6A6;  --teal-400: #20C5C5;   /* hành động chính, band ≥ 7.0 */
  --bg: #F5F7FA;  --surface: #FFFFFF;  --border: #E2E8F0;
  --text: #051C36;  --text-muted: #43474E;
  --band-low: #F59E0B;   /* < 6.0 */
  --band-mid: #0D233D;   /* 6.0–6.5 */
  --band-high: #18A6A6;  /* ≥ 7.0 */
  --band-empty: #EEF1F5;
  --err-grammar: #BA1A1A;  --err-vocab: #F59E0B;  --err-structure: #7C3AED;  --fixed: #10B981;
  --radius-sm: 4px; --radius: 8px; --radius-md: 12px; --radius-lg: 16px;
  --font: "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
}
```
Cỡ chữ theo `design/stitch/academic_mastery/DESIGN.md` (headline-xl 36/28 mobile … label-sm 11). Dark mode: phase sau, nhưng mọi màu phải lấy từ biến.

Quy tắc chung: số, nút, tag dùng `white-space: nowrap`; tiêu đề thẻ cắt bằng `text-overflow: ellipsis` kèm `title`; không animation ngoài chuyển trạng thái ≤200ms; tương phản AA.

## 10. Lộ trình và tiêu chí xong

| Bước | Nội dung | Xong khi |
|---|---|---|
| 1 | App shell, router, tokens, layout 3 kích thước, PWA | Mở link trên Windows, iPad, iPhone đều đúng bố cục |
| 2 | `db.js`, `repo.js`, backup JSON | Export → xoá → import khôi phục đủ |
| 3 | Cambridge Practice: ma trận, panel, nhập điểm, `bands.js`, `next-test.js`, link PDF/audio | Nhập 31/40 Reading ra 7.0; ô Tiếp theo đúng |
| 4 | Ghi nhanh + Vocabulary Bank + Grammar Notebook (chưa AI) | Ghi 10 từ/lỗi trong một buổi, lọc theo Cam/Test |
| 5 | Khởi động 15' + `leitner.js` | Một buổi khởi động đủ 4 dạng bài, hộp cập nhật đúng |
| 6 | Dashboard | Số liệu khớp với dữ liệu thật |
| 6b | Luyện đề trong app (mục 5.9) | Laptop: chọn PDF + 4 audio, làm Listening, nộp, chấm → ô L trên ma trận đúng band; tải lại giữa chừng không mất đáp án; 390px dùng được bằng tab Đề/Phiếu |
| 7 | Đồng bộ Google Drive | Sửa trên iPhone, mở Windows thấy trong ≤ 1 phút |
| 8a | AI copy/paste (2a): "Hoàn thiện với Claude" cho từ và lỗi ghi nhanh (mục 6.6, tác vụ `vocab_enrich`, `error_enrich`) | Ghi 3 từ chỉ có chữ + 1 lỗi → sao chép prompt → dán JSON mẫu → duyệt, sửa, tick → lưu: thẻ có IPA, nghĩa, collocation, lỗi có nhóm + signature; trùng thì gộp, giữ box Leitner của thẻ cũ; JSON sai thì báo và không lưu gì |
| 8b | AI copy/paste (2a): Writing & Speaking (mục 5.6), tạo bài tập từ lỗi | Dán JSON hợp lệ → khay lưu → sổ cập nhật |
| 9 | AI qua proxy (2b) | Không có key trong mã nguồn; chấm Task 2 < 60s |

Mỗi bước: chạy thử trên Chrome desktop + Safari iOS, rồi mới sang bước sau.
