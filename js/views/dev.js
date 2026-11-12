// Dev tools, reachable only with ?dev=1 (route registered in app.js).
import { STORE_NAMES } from "../services/schema.js";
import { exportRaw, clearAll, put, softDelete, list, RepoError } from "../services/repo.js";
import { isoDate } from "../services/leitner.js";
import { buildBackup, importData } from "../services/backup.js";
import { BackupError } from "../services/merge.js";
import { createSampleData } from "../dev/sample-data.js";

const canon = (data) => JSON.stringify(
  Object.fromEntries(STORE_NAMES.map((s) => [s, [...(data[s] ?? [])].sort((a, b) => String(a.id ?? a.key).localeCompare(String(b.id ?? b.key)))])));

// Round trip required by Step 2: sample -> backup -> clear -> restore (replace) -> identical. Plus guards.
async function selfCheck(log) {
  const results = [];
  const check = (name, ok, detail = "") => { results.push(ok); log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };

  await clearAll();
  await createSampleData();
  const before = await exportRaw();
  const counts = `${before.vocab.length} từ, ${before.errors.length} lỗi, ${before.attempts.length} attempt`;
  check("tạo dữ liệu mẫu", before.vocab.length === 10 && before.errors.length === 5 && before.attempts.length === 6, counts);

  const text = JSON.stringify(await buildBackup());
  await clearAll();
  const empty = await exportRaw();
  check("xoá toàn bộ", STORE_NAMES.every((s) => empty[s].length === 0));

  await importData(JSON.parse(text), "replace", { autoBackup: false });
  const after = await exportRaw();
  check("khôi phục (Thay thế) giống hệt trước khi xoá", canon(before) === canon(after));

  await importData(JSON.parse(text), "merge", { autoBackup: false });
  check("khôi phục (Gộp) cùng tệp: không đổi, không nhân đôi", canon(before) === canon(await exportRaw()));

  const bad = JSON.parse(text);
  bad.data.vocab.push({ ...bad.data.vocab[0], id: crypto.randomUUID() });
  let errMsg = "";
  try { await importData(bad, "replace", { autoBackup: false }); } catch (e) { errMsg = e instanceof BackupError ? e.message : `sai loại lỗi: ${e}`; }
  check("Thay thế với 2 vocab trùng lemmaPos: báo lỗi, DB giữ nguyên", /trùng/.test(errMsg) && canon(before) === canon(await exportRaw()), errMsg);

  let dupMsg = "";
  try { await put("vocab", { lemma: "Mitigate ", pos: "verb", meaningVi: "x" }); } catch (e) { dupMsg = e instanceof RepoError ? e.message : `sai loại lỗi: ${e}`; }
  check("put từ trùng lemma+pos: báo lỗi, không ghi đè", dupMsg.includes("đã có trong kho"), dupMsg);

  const urban = (await list("vocab")).find((v) => v.lemma === "urbanisation");
  const other = (await list("vocab")).find((v) => v.lemma === "viable");
  let posMsg = "";
  try { await put("vocab", { ...other, lemma: "urbanisation", pos: "noun" }); } catch (e) { posMsg = e instanceof RepoError ? e.message : `sai loại lỗi: ${e}`; }
  check("đổi pos/lemma đụng bản ghi khác: báo lỗi", posMsg.includes("đã có trong kho"), posMsg);

  const moved = await put("vocab", { ...other, pos: "adj." });
  check("đổi pos: lemmaPos được tính lại", moved.lemmaPos === "viable|adj.", moved.lemmaPos);

  await softDelete("vocab", urban.id);
  check("softDelete: list bỏ qua bản ghi đã xoá", !(await list("vocab")).some((v) => v.id === urban.id));
  const revived = await put("vocab", { lemma: "urbanisation", pos: "noun", meaningVi: "thêm lại" });
  check("thêm lại từ đã xoá: dùng lại id cũ", revived.id === urban.id && revived.deleted === false);

  await clearAll();
  await createSampleData();
  const ok = results.every(Boolean);
  log(ok ? "\nTẤT CẢ ĐẠT" : "\nCÓ LỖI");
  return ok;
}

export function devView(container) {
  container.innerHTML = `
    <h1 class="page-title">Dev</h1>
    <p class="page-sub">Chỉ hiện khi URL có ?dev=1. Dữ liệu mẫu chỉ để thử nghiệm.</p>
    <div class="dev-actions">
      <button class="btn btn-primary" data-act="seed">Tạo dữ liệu mẫu</button>
      <button class="btn btn-outline" data-act="due">Đặt mọi từ đến hạn hôm nay</button>
      <button class="btn btn-outline" data-act="check">Chạy kiểm tra khứ hồi</button>
      <button class="btn btn-danger" data-act="wipe">Xoá toàn bộ dữ liệu</button>
    </div>
    <table class="dev-table"><thead><tr><th>Store</th><th>Còn</th><th>Đã xoá</th></tr></thead><tbody></tbody></table>
    <pre class="dev-log" id="selfcheck" aria-live="polite"></pre>`;

  const tbody = container.querySelector("tbody");
  const logEl = container.querySelector("#selfcheck");
  const log = (line) => { logEl.textContent += line + "\n"; };

  async function refresh() {
    const data = await exportRaw();
    tbody.replaceChildren(...STORE_NAMES.map((s) => {
      const tr = document.createElement("tr");
      const dead = data[s].filter((r) => r.deleted).length;
      for (const text of [s, data[s].length - dead, dead]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.append(td);
      }
      return tr;
    }));
  }

  const run = async (fn) => {
    try { await fn(); } catch (e) { log(`LỖI: ${e.message}`); }
    await refresh();
  };

  container.querySelector('[data-act="seed"]').addEventListener("click", () => run(async () => {
    await clearAll();
    await createSampleData();
  }));
  container.querySelector('[data-act="due"]').addEventListener("click", () => run(async () => {
    const today = isoDate();
    for (const w of await list("vocab")) await put("vocab", { ...w, nextReview: today });
    log(`Đã đặt nextReview = ${today} cho mọi từ.`);
  }));
  container.querySelector('[data-act="wipe"]').addEventListener("click", () => run(async () => {
    if (confirm("Xoá toàn bộ dữ liệu trong máy này? Không thể hoàn tác (hãy sao lưu trước).")) await clearAll();
  }));
  container.querySelector('[data-act="check"]').addEventListener("click", () => run(async () => {
    if (!confirm("Kiểm tra sẽ xoá dữ liệu hiện tại rồi tạo lại dữ liệu mẫu. Tiếp tục?")) return;
    logEl.textContent = "";
    await selfCheck(log);
  }));

  const onChange = () => refresh();
  document.addEventListener("elh:data-changed", onChange);
  refresh();

  if (new URLSearchParams(location.search).get("autorun") === "1") {
    logEl.textContent = "";
    run(async () => { logEl.dataset.done = (await selfCheck(log)) ? "pass" : "fail"; });
  }
}
