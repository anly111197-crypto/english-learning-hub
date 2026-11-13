# Progress handoff

Äá»c cÃ¹ng `docs/spec.md` (roadmap má»¥c 10), `docs/decisions.md` (nháº­t kÃ½ quyáº¿t Ä‘á»‹nh) vÃ  `.agent/rules/elh-project.md` (luáº­t lÃ m viá»‡c: má»—i láº§n má»™t bÆ°á»›c, káº¿ hoáº¡ch trÆ°á»›c khi code, commit káº¿t thÃºc báº±ng dÃ²ng Co-Authored-By).

## 1. CÃ¡c bÆ°á»›c Ä‘Ã£ xong

| BÆ°á»›c | Ná»™i dung | Commit |
|---|---|---|
| 1 | App shell, router, layout, PWA | `e52281f` |
| 2 | IndexedDB + sao lÆ°u JSON | `615e93d` |
| 3 | Cambridge Practice (tracker) | `f26b2d8` |
| 4a | Ghi nhanh + Vocabulary Bank | `f85285a` (+ `b2bd5ed` nguá»“n máº·c Ä‘á»‹nh háº¿t háº¡n sau 3 giá») |
| 4b | Grammar Notebook + tab Notebook | `c5f54c4` (+ `8ced787` chip cuá»™n ngang) |
| 5 | Khá»Ÿi Ä‘á»™ng 15 phÃºt (Leitner Ä‘áº§y Ä‘á»§) | `dd70490` |
| 6 | Dashboard | `3217c47` |
| 6b | Luyá»‡n Ä‘á» trong app (spec 5.9) | commit "Step 6b: in-app practice" (`git log --grep="Step 6b"`) |
| 7 | Đồng bộ Google Drive (spec 7.2) | commit "Step 7: Google Drive sync" (`git log --grep="Step 7"`) |

## 2. Quy Æ°á»›c chÆ°a cÃ³ trong spec

- **`elh:data-changed`** (sá»± kiá»‡n trÃªn `document`): phÃ¡t sau má»i thay Ä‘á»•i dá»¯ liá»‡u tá»« giao diá»‡n (ghi nhanh, form notebook, khÃ´i phá»¥c, nÃºt dev). Má»—i view danh sÃ¡ch vÃ  dÃ²ng nháº¯c sao lÆ°u tá»± náº¡p láº¡i khi nghe nÃ³. View má»›i ghi dá»¯ liá»‡u pháº£i phÃ¡t sá»± kiá»‡n nÃ y. `elh:backup-done` phÃ¡t sau khi sao lÆ°u.
- **`components/overlay.js`**: bá»™ Ä‘áº¿m lá»›p phá»§; Ä‘áº·t `body[data-overlay-open]` Ä‘á»ƒ áº©n nÃºt FAB. Sheet vÃ  modal (`<dialog>`) Ä‘á»u Ä‘i qua nÃ³; dialog má»›i pháº£i dÃ¹ng `overlay.js`.
- **Query cá»§a router**: `#/vocab?due=1`, `#/errors?type=articles&status=open`, `#/practice?status=improve&skill=R`. Router gá»i `view.mount(container, params, query)` vÃ  `update(params, query)`. View Ä‘áº·t láº¡i bá»™ lá»c má»—i láº§n má»Ÿ rá»“i Ã¡p query, nÃªn link tá»« Dashboard luÃ´n má»Ÿ Ä‘Ãºng bá»™ lá»c.
- **`?dev=1`** (query Ä‘á»©ng trÆ°á»›c dáº¥u `#`): báº­t route `#/dev` (dá»¯ liá»‡u máº«u, kiá»ƒm tra tá»± Ä‘á»™ng, nÃºt "Äáº·t má»i tá»« Ä‘áº¿n háº¡n hÃ´m nay"). `&autorun=1` tá»± cháº¡y kiá»ƒm tra. **`&clock=GIÃ‚Y`** rÃºt ngáº¯n Ä‘á»“ng há»“ tá»«ng bÆ°á»›c khá»Ÿi Ä‘á»™ng Ä‘á»ƒ thá»­ "háº¿t giá»" (chá»‰ cÃ³ hiá»‡u lá»±c khi cÃ³ `dev=1`).
- **Sá»‘ liá»‡u Dashboard** luÃ´n tÃ­nh láº¡i tá»« báº£ng khi má»Ÿ trang (`services/dashboard-stats.js`), khÃ´ng lÆ°u. HÃ m thuáº§n thÃ¬ cÃ³ test, view chá»‰ váº½.
- **Service worker** network-first. Má»—i bÆ°á»›c pháº£i tÄƒng `CACHE_VERSION` (nay `elh-v11`) vÃ  giá»¯ `APP_SHELL` Ä‘á»§ file. Service worker bá» qua `blob:` vÃ  `drive.google.com`: file cá»§a ngÆ°á»i há»c khÃ´ng bao giá» vÃ o cache.
- **Giao diá»‡n**: chá»‰ dÃ¹ng token trong `css/tokens.css` (khÃ´ng viáº¿t mÃ£ mÃ u cá»©ng); chá»¯ UI tiáº¿ng Viá»‡t, mÃ£ vÃ  comment tiáº¿ng Anh.
- **MÃ n Luyá»‡n Ä‘á»** (`views/practice-run.js`, nguá»“n Ä‘á» vÃ  audio á»Ÿ `practice-run-source.js`, luáº­t thuáº§n á»Ÿ `services/practice-run.js`): toÃ n mÃ n, `body[data-route="practice-run"]` áº©n nav vÃ  FAB. NhÃ¡p L/R á»Ÿ localStorage `elh.run.<book>-<test>-<skill>` (Writing: thÃªm `-<task>`, vÄƒn báº£n cÃ²n á»Ÿ `submissions`); tÃªn file Ä‘Ã£ chá»n á»Ÿ `elh.runFiles.<book>-<test>`. NhÃ¡p chá»‰ xoÃ¡ sau khi lÆ°u attempt thÃ nh cÃ´ng. LÆ°u Ä‘iá»ƒm dÃ¹ng `saveAttempt` nhÆ° modal Nháº­p káº¿t quáº£.
- **Đồng bộ Drive** (`services/sync-controller.js` lịch và trạng thái, `sync-drive.js` vòng kéo-gộp-đẩy thuần, `google-auth.js` GIS, `components/sync-ui.js` dòng trạng thái và hộp thoại, Client ID ở `js/config.js`). Token chỉ ở bộ nhớ; localStorage chỉ có cờ `elh.sync.*`. `elh:sync-state` báo trạng thái; kéo mà dữ liệu đổi thì phát `elh:data-changed` với `detail.fromSync` (không kích hoạt đẩy lại). Muốn thử giao diện không cần Google: kịch bản e2e `sync` chèn GIS và Drive giả.
- **XoÃ¡ má»m**: báº£n ghi cÃ³ `deleted`; táº¡o láº¡i cÃ¹ng id thÃ¬ há»“i sinh. `vocab.lemmaPos`, `notes.linkKeys` lÃ  chá»‰ má»¥c dáº«n xuáº¥t.

**Kiá»ƒm thá»­**
- ÄÆ¡n vá»‹: `node --test tests/*.test.js` (195 test, pass).
- Headless (Chrome qua CDP, phÃ­m vÃ  chuá»™t tháº­t): `python -m http.server 8765` á»Ÿ thÆ° má»¥c repo, rá»“i `node tests/e2e/run.mjs <ká»‹ch báº£n> [thÆ°-má»¥c-xuáº¥t]`. Danh sÃ¡ch ká»‹ch báº£n vÃ  cÃ¡ch Ä‘á»c káº¿t quáº£: `tests/e2e/README.md`. Script luÃ´n thoÃ¡t mÃ£ 0, pháº£i tá»± Ä‘á»c `FAIL` vÃ  dÃ²ng `console problems`. KhÃ´ng náº±m trong `APP_SHELL`.

## 3. ChÆ°a thá»­ trÃªn thiáº¿t bá»‹ tháº­t

- Safari iOS vÃ  iPad tháº­t, thao tÃ¡c cháº¡m, Add to Home Screen.
- Service worker offline (chá»‰ kiá»ƒm tra má»i file trong `APP_SHELL` tá»“n táº¡i).
- Ã‚m thanh phÃ¡t Ã¢m tháº­t (Web Speech), má»Ÿ CSV trong Excel tháº­t, Ä‘áº§u ra NotebookLM tháº­t.
- MÃ n hÃ¬nh iPad 768â€“1023px: chá»‰ suy ra tá»« quy táº¯c CSS, chÆ°a chá»¥p riÃªng.
- Đồng bộ Drive với Google THẬT (e2e chỉ dùng GIS và Drive giả): đăng nhập, xin token im lặng, token hết hạn sau 1 giờ, Safari iOS (popup, ITP), hai thiết bị thật, nạp script `accounts.google.com/gsi/client` thật. Tiêu chí xong của Bước 7 (thêm từ ở laptop, thấy trên iPhone ≤ 1 phút và ngược lại) cần người dùng tự thử.
- Luyá»‡n Ä‘á»: PDF nhÃºng trÃªn Safari iOS (thÆ°á»ng chá»‰ hiá»‡n trang Ä‘áº§u), khung xem Drive bá»‹ cháº·n tháº­t, chá»n file tá»« á»©ng dá»¥ng Tá»‡p/Drive trÃªn iPad, audio vÃ  PDF tháº­t cá»§a Cambridge (e2e chá»‰ dÃ¹ng file giáº£).

## 4. Bước tiếp theo

1. **8 — AI copy/paste** (nhãn "Claude"; dùng bài Writing đã có `doneAt`).
2. **9 — AI qua proxy** (Cloudflare Worker, không có key trong mã nguồn).
