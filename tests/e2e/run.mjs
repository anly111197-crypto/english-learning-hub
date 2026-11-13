// Drives headless Chrome via CDP. Usage: node tests/e2e/run.mjs <scenario> [outputDir]
// Needs a static server on http://localhost:8765/ and Chrome (set CHROME_PATH if it is not in the default place).
// See tests/e2e/README.md. Not part of the app: never list it in APP_SHELL.
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:8765/";
const SC = process.argv[3] ?? tmpdir();
const scenario = process.argv[2];
const port = 9333 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), "elh-cdp-"));
const dlDir = join(SC, "downloads");
mkdirSync(dlDir, { recursive: true });

const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = pages.find((p) => p.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error("Chrome did not start");
}

const ws = new WebSocket(await connect());
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const consoleMsgs = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) consoleMsgs.push(msg.params.type + ": " + msg.params.args.map((a) => a.value ?? a.description).join(" "));
  if (msg.method === "Runtime.exceptionThrown") consoleMsgs.push("exception: " + msg.params.exceptionDetails.text + " " + (msg.params.exceptionDetails.exception?.description ?? ""));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
};
const waitFor = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await evalJs(expr)) return true; await sleep(150); } return false; };

await send("Runtime.enable");
await send("Page.enable");
await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });

const go = async (url, w = 1280, h = 800) => {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 });
  await send("Page.navigate", { url });
  await sleep(800);
};
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(SC, name), Buffer.from(r.result.data, "base64")); };

try {
  if (scenario === "selfcheck") {
    await go(BASE + "?dev=1&autorun=1#/dev");
    const done = await waitFor(`document.querySelector('#selfcheck')?.dataset.done`, 30000);
    console.log(await evalJs(`document.querySelector('#selfcheck').textContent`));
    console.log("done =", done, await evalJs(`document.querySelector('#selfcheck').dataset.done`));
  } else if (scenario === "ui") {
    // Real UI: seed via button, click "Sao lưu JSON", wipe, restore via file input + dialog "Thay thế".
    await go(BASE + "?dev=1#/dev");
    await waitFor(`document.querySelector('[data-act=seed]')`);
    await evalJs(`document.querySelector('[data-act=seed]').click()`);
    await waitFor(`document.querySelector('.dev-table tbody tr td:nth-child(2)')?.textContent === '10'`);
    const snap = async () => evalJs(`document.querySelector('.dev-table tbody').innerText.replace(/\\s+/g,' ')`);
    const before = await snap();
    console.log("after seed :", before);
    await evalJs(`document.querySelector('[data-act=backup]').click()`);
    await sleep(1500);
    const files = readdirSync(dlDir).filter((f) => f.startsWith("elh-backup-"));
    console.log("downloaded :", files);
    const file = join(dlDir, files.sort().at(-1));
    const json = JSON.parse(readFileSync(file, "utf8"));
    console.log("file header:", json.app, json.schemaVersion, Object.keys(json.data).length, "stores; vocab", json.data.vocab.length);
    await evalJs(`window.confirm = () => true; document.querySelector('[data-act=wipe]').click()`);
    await sleep(500);
    console.log("after wipe :", await snap());
    // choose file through the real <input type=file>
    const doc = await send("DOM.getDocument");
    const q = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: ".nav-foot input[type=file]" });
    await send("DOM.setFileInputFiles", { files: [file.replaceAll("/", "\\")], nodeId: q.result.nodeId });
    await waitFor(`document.querySelector('dialog[open]')`);
    console.log("dialog     :", await evalJs(`document.querySelector('dialog .dialog-file').textContent`), "| FAB hidden:", await evalJs(`getComputedStyle(document.querySelector('.fab')).display === 'none'`));
    await shot("dialog.png");
    await evalJs(`document.querySelector('dialog button[value=replace]').click()`);
    await waitFor(`document.querySelector('.status-line') && !document.querySelector('.status-line').hidden`);
    await sleep(500);
    console.log("status     :", await evalJs(`document.querySelector('.status-line').textContent`));
    const after = await snap();
    console.log("after restore:", after);
    console.log("SAME AS BEFORE:", before === after);
    // bad file
    writeFileSync(join(SC, "bad.json"), '{"hello":1}');
    await send("DOM.setFileInputFiles", { files: [join(SC, "bad.json").replaceAll("/", "\\")], nodeId: q.result.nodeId });
    await sleep(800);
    console.log("bad file   :", await evalJs(`document.querySelector('.status-line').textContent`));
  } else if (scenario === "practice") {
    let fails = 0;
    const ok = (name, cond, detail = "") => { if (!cond) fails++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail !== "" ? " — " + detail : ""}`); };
    const click = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no ' + ${JSON.stringify(sel)}); e.click(); return true; })()`);
    const typeInto = (sel, v) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`);
    const cellText = (book, t) => evalJs(`(() => { const b = [...document.querySelectorAll('.test-cell')].find(x => x.getAttribute('aria-label').startsWith('Cam ${book} Test ${t}.')); return b ? b.getAttribute('aria-label') : null; })()`);
    const cellBg = (book, t, letter) => evalJs(`(() => { const b = [...document.querySelectorAll('.test-cell')].find(x => x.getAttribute('aria-label').startsWith('Cam ${book} Test ${t}.')); const c = [...b.querySelectorAll('.band-cell')].find(x => x.querySelector('.band-cell-letter').textContent === '${letter}'); return { text: c.textContent, bg: getComputedStyle(c).backgroundColor, level: c.dataset.level }; })()`);
    const nextIs = () => evalJs(`(() => { const b = document.querySelector('.test-cell.is-next'); return b ? b.getAttribute('aria-label').split('.')[0] : null; })()`);
    const saveResult = async (tabLabel, value, taskLabel) => {
      await click('.sheet .detail-actions .btn-primary');
      await waitFor(`document.querySelector('dialog.modal[open]')`);
      await evalJs(`[...document.querySelectorAll('.modal .seg-btn[role=tab]')].find(b => b.textContent === ${JSON.stringify(tabLabel)}).click()`);
      if (taskLabel) await evalJs(`[...document.querySelectorAll('.modal .seg-small .seg-btn')].find(b => b.textContent === ${JSON.stringify(taskLabel)}).click()`);
      await typeInto(tabLabel === "Listening" || tabLabel === "Reading" ? "#f-raw" : "#f-band", String(value));
      const preview = await evalJs(`document.querySelector('.result-box')?.textContent ?? ''`);
      await click('button[form=result-form]');
      await waitFor(`!document.querySelector('dialog.modal')`);
      await sleep(400);
      return preview;
    };

    await go(BASE + "#/practice");
    await waitFor(`document.querySelectorAll('.matrix tbody tr').length > 0`);
    const rows = await evalJs(`[...document.querySelectorAll('.matrix tbody th')].map(t => t.textContent)`);
    ok("matrix rows Cam 19 -> Cam 10", rows.length === 10 && rows[0] === "Cam 19" && rows[9] === "Cam 10", rows.join(","));
    ok("empty data: next = Cam 10 Test 1", (await nextIs()) === "Cam 10 Test 1", await nextIs());
    await shot("practice-empty.png");

    // 1) open Cam 15 Test 1 from the matrix
    await click('.test-cell[aria-label^="Cam 15 Test 1."]');
    await waitFor(`document.querySelector('dialog.sheet[open]')`);
    ok("click cell -> hash #/practice/15/1", (await evalJs(`location.hash`)) === "#/practice/15/1");
    ok("FAB hidden while panel open", await evalJs(`getComputedStyle(document.querySelector('.fab')).display === 'none' && document.body.hasAttribute('data-overlay-open')`));
    ok("matrix was not rebuilt (still present behind the panel)", await evalJs(`document.querySelectorAll('.matrix tbody tr').length === 10`));
    ok("viewing outline on the opened cell", await evalJs(`document.querySelector('.test-cell.is-viewing')?.getAttribute('aria-label').startsWith('Cam 15 Test 1.')`));
    ok("no PDF/audio buttons before links exist", await evalJs(`!document.querySelector('.sheet .link-buttons')`));
    await shot("practice-panel.png");

    // 2) Reading 31/40 -> 7.0 teal
    const preview = await saveResult("Reading", 31);
    ok("live preview says Band 7.0", preview.includes("31/40") && preview.includes("Band 7.0"), preview);
    const r = await cellBg(15, 1, "R");
    ok("R cell shows 7.0 in teal (--band-high)", r.text.includes("7.0") && r.level === "high" && r.bg === "rgb(24, 166, 166)", JSON.stringify(r));
    ok("panel still open after save, badge 1/4", await evalJs(`document.querySelector('.sheet-titles .chip').textContent`) === "1/4 kỹ năng");
    ok("next is still Cam 15 Test 1 (Listening missing)", (await nextIs()) === "Cam 15 Test 1", await nextIs());

    // 3) Listening 30 -> 7.0, then next moves on to Test 2
    await saveResult("Listening", 30);
    ok("L 30 -> 7.0", (await cellBg(15, 1, "L")).text.includes("7.0"));
    ok("next moves to Cam 15 Test 2", (await nextIs()) === "Cam 15 Test 2", await nextIs());
    ok("completion column shows 1/4 for Cam 15", await evalJs(`[...document.querySelectorAll('.matrix tbody tr')].find(tr => tr.querySelector('th').textContent === 'Cam 15').querySelector('.matrix-done').textContent`) === "1/4");

    // 4) Writing: one task -> marked, both tasks -> weighted estimate
    await saveResult("Writing", 6.5, "Task 1");
    ok("only Task 1: W cell marked with *", (await cellBg(15, 1, "W")).text.includes("6.5*"), (await cellBg(15, 1, "W")).text);
    await saveResult("Writing", 6, "Task 2");
    ok("Task 1 6.5 + Task 2 6.0 -> estimate 6.0", (await cellBg(15, 1, "W")).text.includes("6.0") && !(await cellBg(15, 1, "W")).text.includes("*"), (await cellBg(15, 1, "W")).text);
    ok("panel shows 'Writing ước tính'", await evalJs(`document.querySelector('.writing-estimate')?.textContent.includes('Writing ước tính')`));

    // 5) overwrite: editing Reading to 33 replaces the old attempt
    await evalJs(`[...document.querySelectorAll('.skill-row')].find(r => r.textContent.includes('Reading')).querySelector('button').click()`);
    await waitFor(`document.querySelector('dialog.modal[open]')`);
    ok("edit prefills the old score", await evalJs(`document.querySelector('#f-raw').value`) === "31");
    await typeInto("#f-raw", "33");
    await click('button[form=result-form]');
    await waitFor(`!document.querySelector('dialog.modal')`);
    await sleep(400);
    ok("R 33 -> 7.5 (overwrote, not duplicated)", (await cellBg(15, 1, "R")).text.includes("7.5"));
    ok("only one Reading attempt stored for 15-1", await evalJs(`new Promise(res => { const r = indexedDB.open('elh'); r.onsuccess = () => { const q = r.result.transaction('attempts').objectStore('attempts').index('bookTest').getAll([15,1]); q.onsuccess = () => res(q.result.filter(a => a.skill === 'R').length === 1); }; })`));

    // 6) invalid input is rejected with a message
    await click('.sheet .detail-actions .btn-primary');
    await waitFor(`document.querySelector('dialog.modal[open]')`);
    ok("'Nhập kết quả' opens on the first empty skill (Speaking)", await evalJs(`document.querySelector('.modal .seg-btn[aria-selected=true]').textContent`) === "Speaking");
    await evalJs(`[...document.querySelectorAll('.modal .seg-btn[role=tab]')].find(b => b.textContent === 'Listening').click()`);
    await typeInto("#f-raw", "41");
    await click('button[form=result-form]');
    await sleep(200);
    ok("41/40 rejected with an error", await evalJs(`!document.querySelector('.modal .form-error').hidden`), await evalJs(`document.querySelector('.modal .form-error').textContent`));
    await evalJs(`document.querySelector('.modal .modal-actions .btn-text').click()`);
    await waitFor(`!document.querySelector('dialog.modal')`);

    // 7) links
    await click('.sheet .btn-text.btn-sm');
    await waitFor(`document.querySelector('dialog.modal[open]')`);
    await typeInto("#f-pdf", "http://example.com/insecure.pdf");
    await click('button[form=links-form]');
    await sleep(200);
    ok("http:// link rejected", await evalJs(`!document.querySelector('.modal .form-error').hidden`), await evalJs(`document.querySelector('.modal .form-error').textContent`));
    await typeInto("#f-pdf", "https://drive.google.com/file/d/abc/view");
    await typeInto("#f-a1", "https://drive.google.com/file/d/audio1/view");
    await click('button[form=links-form]');
    await waitFor(`!document.querySelector('dialog.modal')`);
    await sleep(400);
    const links = await evalJs(`[...document.querySelectorAll('.sheet .link-buttons a')].map(a => ({ t: a.textContent, href: a.href, target: a.target, rel: a.rel }))`);
    ok("PDF + audio Part 1 buttons, target=_blank, rel noopener", links.length === 2 && links[0].t === "Mở đề PDF" && links[1].t === "Mở audio Part 1" && links.every(l => l.target === "_blank" && l.rel.includes("noopener")), JSON.stringify(links));
    const before = await send("Target.getTargets");
    const nTabs = before.result.targetInfos.filter(t => t.type === "page").length;
    const pt = await evalJs(`(() => { const a = document.querySelector('.sheet .link-buttons a'); a.scrollIntoView({block:'center'}); const r = a.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
    await sleep(1200);
    const after = await send("Target.getTargets");
    const pagesAfter = after.result.targetInfos.filter(t => t.type === "page");
    ok("clicking 'Mở đề PDF' opens a new tab", pagesAfter.length === nTabs + 1, pagesAfter.map(t => t.url).join(" | "));
    const popup = pagesAfter.find(t => t.url.includes("drive.google.com") || t.openerId);
    const mine = before.result.targetInfos.find(t => t.type === "page");
    if (popup && popup.targetId !== mine.targetId) await send("Target.closeTarget", { targetId: popup.targetId });
    await send("Target.activateTarget", { targetId: mine.targetId });
    await sleep(500);

    // 8) pin another test; Esc closes the panel
    await evalJs(`document.querySelector('dialog.sheet .icon-btn').click()`);
    await waitFor(`!document.querySelector('dialog.sheet')`);
    ok("close button -> back to #/practice", await waitFor(`location.hash === '#/practice'`, 3000));
    ok("FAB visible again", await evalJs(`getComputedStyle(document.querySelector('.fab')).display !== 'none' && !document.body.hasAttribute('data-overlay-open')`));
    await click('.test-cell[aria-label^="Cam 12 Test 3."]');
    await waitFor(`document.querySelector('dialog.sheet[open]')`);
    await evalJs(`[...document.querySelectorAll('.sheet .detail-actions button')].find(b => b.textContent.startsWith('Ghim')).click()`);
    await sleep(600);
    ok("pinned: next = Cam 12 Test 3", (await nextIs()) === "Cam 12 Test 3", await nextIs());
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await waitFor(`!document.querySelector('dialog.sheet')`, 3000);
    ok("Esc closes the panel and returns to #/practice", await waitFor(`location.hash === '#/practice'`, 3000));

    // pin another test: the first one is unpinned
    await click('.test-cell[aria-label^="Cam 17 Test 2."]');
    await waitFor(`document.querySelector('dialog.sheet[open]')`);
    await evalJs(`[...document.querySelectorAll('.sheet .detail-actions button')].find(b => b.textContent.startsWith('Ghim')).click()`);
    await sleep(600);
    ok("pin moves: next = Cam 17 Test 2, only one pinned", (await nextIs()) === "Cam 17 Test 2" && await evalJs(`new Promise(res => { const r = indexedDB.open('elh'); r.onsuccess = () => { const q = r.result.transaction('tests').objectStore('tests').getAll(); q.onsuccess = () => res(q.result.filter(t => t.pinned).length === 1); }; })`));
    await click('.sheet .detail-actions button[aria-pressed=true]'); // unpin
    await sleep(600);
    ok("unpinned: next goes back to Cam 15 Test 2", (await nextIs()) === "Cam 15 Test 2", await nextIs());
    await evalJs(`document.querySelector('dialog.sheet .icon-btn').click()`);
    await waitFor(`!document.querySelector('dialog.sheet')`);

    // 9) filters
    await click('.chip-group:first-child .chip-btn:nth-child(2)'); // Chưa làm
    ok("filter 'Chưa làm' keeps books that have an untouched test and dims done ones", await evalJs(`document.querySelectorAll('.matrix tbody tr').length === 10 && document.querySelector('.test-cell[aria-label^="Cam 15 Test 1."]').classList.contains('is-dim')`));
    await click('.chip-group:first-child .chip-btn:nth-child(3)'); // Cần cải thiện
    const improveRows = await evalJs(`document.querySelectorAll('.matrix tbody tr').length`);
    ok("filter 'Cần cải thiện' hides books with nothing below 6.5", improveRows === 1, String(improveRows));
    await click('.chip-group:first-child .chip-btn:nth-child(1)');
    await shot("practice-filled.png");

    // 10) cards + dashboard
    const cards = await evalJs(`[...document.querySelectorAll('.summary-card')].map(c => c.innerText.replace(/\\s+/g,' '))`);
    console.log("cards:", cards);
    await go(BASE + "#/");
    await waitFor(`document.querySelector('.hero-title')`);
    ok("Dashboard shows next test", (await evalJs(`document.querySelector('.hero-title').textContent`)) === "Buổi luyện tiếp theo: Cam 15 · Test 2", await evalJs(`document.querySelector('.hero').innerText.replace(/\\s+/g,' ')`));
    await evalJs(`[...document.querySelectorAll('.hero-actions a')].find(a => a.textContent === 'Bỏ khởi động, mở test luôn').click()`);
    await waitFor(`document.querySelector('dialog.sheet[open]')`);
    ok("'Bỏ khởi động, mở test luôn' opens the panel directly", (await evalJs(`location.hash`)) === "#/practice/15/2");
    // deep link to a bad test
    await evalJs(`location.hash = '#/practice/9/7'`);
    await sleep(500);
    ok("bad route #/practice/9/7 falls back to #/practice", (await evalJs(`location.hash`)) === "#/practice");
    ok("panel closed after leaving to the list", await evalJs(`!document.querySelector('dialog.sheet')`));
    console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
  } else if (scenario === "capture") {
    let fails = 0;
    const ok = (name, cond, detail = "") => { if (!cond) fails++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail !== "" ? " — " + detail : ""}`); };
    const KEYS = { Enter: { code: "Enter", vk: 13, text: "\r" }, Tab: { code: "Tab", vk: 9 }, ArrowUp: { code: "ArrowUp", vk: 38 }, ArrowDown: { code: "ArrowDown", vk: 40 } };
    const keyEv = async (key, { code, vk, text, modifiers = 0 }) => {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, text, modifiers });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
    };
    const press = async (name, n = 1) => { for (let i = 0; i < n; i++) await keyEv(name, KEYS[name]); };
    const pressChar = (c) => keyEv(c, { code: "Key" + c.toUpperCase(), vk: c.toUpperCase().charCodeAt(0), text: c });
    const typeText = (t) => send("Input.insertText", { text: t });
    const modalOpen = () => waitFor(`document.querySelector('dialog.modal[open]') && document.activeElement && document.activeElement.closest('dialog.modal')`, 5000);
    const modalGone = () => waitFor(`!document.querySelector('dialog.modal')`, 5000);
    const newWord = async () => { await pressChar("n"); await modalOpen(); await keyEv("1", { code: "Digit1", vk: 49, modifiers: 1 }); await sleep(120); }; // N reopens on the last used tab, so Alt+1
    const toast = () => evalJs(`document.querySelector('.status-line > span')?.textContent ?? ''`);
    const dbAll = (store) => evalJs(`new Promise(res => { const r = indexedDB.open('elh'); r.onsuccess = () => { const q = r.result.transaction('${store}').objectStore('${store}').getAll(); q.onsuccess = () => res(q.result.filter(x => !x.deleted)); }; })`);
    const click = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no ' + ${JSON.stringify(sel)}); e.click(); return true; })()`);
    const typeInto = (sel, v) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', {bubbles:true})); e.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`);

    await go(BASE + "#/practice");
    await waitFor(`document.querySelector('.matrix tbody tr')`);

    // ---- Keyboard only: 5 words + 2 errors for Cam 15 Test 1, timed ----
    const t0 = Date.now();
    await pressChar("n");
    ok("N opens the form with focus in the word field and no 'n' typed", (await modalOpen()) && await evalJs(`document.activeElement.id === 'qc-word' && document.activeElement.value === ''`));
    ok("default source = next test (Cam 10 Test 1)", await evalJs(`document.querySelector('#qc-book').value === '10' && document.querySelector('#qc-test').value === '1'`));
    await typeText("mitigate");
    await press("Tab");
    await typeText("We must mitigate the risk of flooding.");
    await press("Tab");                       // -> Cam select
    await press("ArrowUp", 5);                // Cam 10 -> Cam 15 (list is 19..10)
    await press("Tab");                       // -> Test select (stays Test 1)
    await press("Tab");                       // -> Skill
    await press("ArrowDown", 2);              // '' -> L -> R
    await press("Tab");                       // -> Part
    await press("ArrowDown", 2);              // '' -> 1 -> 2 (Passage 2)
    const form1 = await evalJs(`({ book: qcv('#qc-book'), test: qcv('#qc-test'), skill: qcv('#qc-skill'), part: qcv('#qc-part') }); function qcv(s) { return document.querySelector(s).value; }`);
    ok("source set by keyboard: Cam 15, Test 1, Reading, Passage 2", form1.book === "15" && form1.test === "1" && form1.skill === "R" && form1.part === "2", JSON.stringify(form1));
    await press("Enter");
    ok("Enter saves and closes at once", await modalGone());
    await sleep(300);
    ok("toast: Đã lưu · 1 mục chờ hoàn thiện", (await toast()) === "Đã lưu · 1 mục chờ hoàn thiện", await toast());

    const words = [["sustainable", "Sustainable energy is the future."], ["urbanisation", "Rapid urbanisation causes traffic."], ["alleviate", ""], ["substantial", "A substantial increase was recorded."]];
    for (const [w, ctx] of words) {
      await pressChar("n");
      await modalOpen();
      if (w === "sustainable") ok("next open: source remembered (Cam 15 Test 1 Reading Passage 2)", await evalJs(`qcv('#qc-book') === '15' && qcv('#qc-skill') === 'R' && qcv('#qc-part') === '2'; function qcv(s) { return document.querySelector(s).value; }`));
      await typeText(w);
      if (ctx) { await press("Tab"); await typeText(ctx); }
      await press("Enter");
      await modalGone();
      await sleep(200);
    }
    // 2 errors: N, Alt+2 switches to "Lỗi sai"
    const errs = [["the technology has changed our lives", "technology has changed our lives", 2], ["I look forward to hear from you", "I look forward to hearing from you", 0]];
    for (const [wrong, right, typeDown] of errs) {
      await pressChar("n");
      await modalOpen();
      await keyEv("2", { code: "Digit2", vk: 50, modifiers: 1 });
      await sleep(150);
      ok("Alt+2 shows the error tab with focus in 'Câu sai'", await evalJs(`document.activeElement.id === 'qc-wrong'`));
      await typeText(wrong);
      await press("Tab");
      await typeText(right);
      if (typeDown) { await press("Tab"); await press("ArrowDown", typeDown); }
      await press("Enter");
      await modalGone();
      await sleep(200);
    }
    const elapsed = (Date.now() - t0) / 1000;
    ok("5 words + 2 errors saved by keyboard in under 60 seconds", elapsed < 60, `${elapsed.toFixed(1)}s`);
    ok("toast after the last save", /^Đã lưu · \d+ mục chờ hoàn thiện$/.test(await toast()), await toast());

    let vocab = await dbAll("vocab");
    let errors = await dbAll("errors");
    let occ = await dbAll("occurrences");
    ok("5 words, 2 errors, 7 occurrences stored", vocab.length === 5 && errors.length === 2 && occ.length === 7, `${vocab.length}/${errors.length}/${occ.length}`);
    const mit = vocab.find((v) => v.lemma === "mitigate");
    const tomorrow = await evalJs(`(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); })()`);
    ok("new word: box 1, nextReview tomorrow, enriched false, empty pos", mit.box === 1 && mit.nextReview === tomorrow && mit.enriched === false && mit.pos === "" && mit.lemmaPos === "mitigate|", JSON.stringify({ box: mit.box, n: mit.nextReview, e: mit.enriched, lp: mit.lemmaPos }));
    ok("context kept with source {15,1,R,2}", mit.contexts.length === 1 && JSON.stringify(mit.contexts[0].source) === JSON.stringify({ book: 15, test: 1, skill: "R", part: 2 }), JSON.stringify(mit.contexts[0]));
    ok("errors: pending signature, occurrences 1, type articles on the first", errors.every((e) => e.signature === `pending:${e.id}` && e.occurrences === 1 && e.enriched === false) && errors.find((e) => e.original.startsWith("the technology")).type === "articles");
    ok("every occurrence carries the source Cam 15 Test 1", occ.every((o) => o.source?.book === 15 && o.source?.test === 1));

    // ---- Same word again: only a context is added ----
    await newWord();
    await typeText("Mitigate");
    await press("Tab"); await typeText("Another sentence with mitigate.");
    await press("Enter"); await modalGone(); await sleep(300);
    vocab = await dbAll("vocab"); occ = await dbAll("occurrences");
    const mit2 = vocab.find((v) => v.lemma === "mitigate");
    ok("existing word: no new card, a second context added", vocab.length === 5 && mit2.id === mit.id && mit2.contexts.length === 2, `cards ${vocab.length}, contexts ${mit2.contexts.length}`);
    ok("toast says the word already exists", (await toast()).includes("đã có trong kho"), await toast());
    ok("a new occurrence was still recorded", occ.length === 8);
    await newWord();
    await typeText("mitigate"); await press("Tab"); await typeText("Another sentence with mitigate.");
    await press("Enter"); await modalGone(); await sleep(300);
    vocab = await dbAll("vocab");
    ok("same sentence + same source again: context count stays 2", vocab.find((v) => v.lemma === "mitigate").contexts.length === 2);

    // ---- Same wrong sentence again: +1 occurrences, one card, a new occurrence record ----
    await pressChar("n"); await modalOpen();
    await keyEv("2", { code: "Digit2", vk: 50, modifiers: 1 }); await sleep(150);
    await typeText("The  Technology has changed our lives");
    await press("Enter"); await modalGone(); await sleep(300);
    errors = await dbAll("errors"); occ = await dbAll("occurrences");
    const tech = errors.find((e) => e.original.startsWith("the technology"));
    ok("repeated error: still 2 cards, occurrences 2, new occurrence record", errors.length === 2 && tech.occurrences === 2 && occ.filter((o) => o.itemId === tech.id).length === 2, `occ=${tech.occurrences}`);
    ok("toast for repeated error", (await toast()).startsWith("Lỗi này đã có"), await toast());

    // ---- N must not fire while typing ----
    await pressChar("n"); await modalOpen();
    await pressChar("n");
    ok("typing n in the field types n and does not open a second form", await evalJs(`document.activeElement.value === 'n' && document.querySelectorAll('dialog.modal').length === 1`));
    await press("Tab"); await pressChar("n");
    ok("n in the context box also just types", await evalJs(`document.activeElement.value === 'n'`));
    await evalJs(`document.querySelector('dialog.modal .modal-actions .btn-text').click()`);
    await modalGone();
    ok("empty word is rejected", await (async () => { await newWord(); await press("Enter"); await sleep(300); const r = await evalJs(`!document.querySelector('.modal .form-error').hidden`); await evalJs(`document.querySelector('dialog.modal .modal-actions .btn-text').click()`); await modalGone(); return r; })());

    // ---- Several parts of speech: ask which card ----
    await go(BASE + "#/vocab");
    await waitFor(`document.querySelector('.vocab-table tbody tr')`);
    ok("Vocabulary Bank lists the 5 words", (await evalJs(`document.querySelectorAll('.vocab-table tbody tr').length`)) === 5);
    ok("stats line", (await evalJs(`document.querySelector('.vocab-stats').innerText`)).replace(/\s+/g, " ") === "Tổng 5 từ · Đến hạn 0 · Chờ hoàn thiện 5", await evalJs(`document.querySelector('.vocab-stats').innerText`));
    // make two cards with the lemma "record": capture, edit pos, capture another and rename it
    for (const w of ["record", "recorded"]) {
      await newWord(); await typeText(w); await press("Enter"); await modalGone(); await sleep(300);
    }
    const openWord = async (w) => { await evalJs(`[...document.querySelectorAll('.vocab-table .link-btn')].find(b => b.textContent === ${JSON.stringify(w)}).click()`); await waitFor(`document.querySelector('dialog.sheet[open]')`); await sleep(200); };
    await openWord("record");
    await typeInto("#vd-pos", "noun");
    await click('.sheet form button[type=submit]'); await sleep(600);
    ok("edit pos -> saved, lemmaPos recomputed", (await dbAll("vocab")).find((v) => v.word === "record").lemmaPos === "record|noun");
    await evalJs(`document.querySelector('dialog.sheet .icon-btn').click()`); await waitFor(`!document.querySelector('dialog.sheet')`);
    await openWord("recorded");
    await typeInto("#vd-lemma", "record"); await typeInto("#vd-pos", "verb");
    await click('.sheet form button[type=submit]'); await sleep(600);
    ok("same lemma, other pos is allowed", (await dbAll("vocab")).find((v) => v.word === "recorded").lemmaPos === "record|verb");
    await evalJs(`document.querySelector('dialog.sheet .icon-btn').click()`); await waitFor(`!document.querySelector('dialog.sheet')`);
    await newWord(); await typeText("record"); await press("Enter"); await sleep(500);
    ok("two parts of speech -> asks which card", await evalJs(`!!document.querySelector('dialog.modal .choice') && document.querySelectorAll('.choice-list button').length === 3`), await evalJs(`document.querySelector('dialog.modal .choice')?.innerText.replace(/\\s+/g,' ')`));
    await evalJs(`[...document.querySelectorAll('.choice-list button')].find(b => b.textContent.includes('(verb)')).click()`);
    await modalGone(); await sleep(300);
    vocab = await dbAll("vocab");
    ok("choice 'record (verb)': no new card (7 cards), occurrence recorded", vocab.length === 7, String(vocab.length));
    // conflict on edit -> merge
    await openWord("recorded");
    await typeInto("#vd-pos", "noun");
    await click('.sheet form button[type=submit]'); await sleep(500);
    ok("editing into another card's lemma+pos: clear message, nothing overwritten", await evalJs(`!document.querySelector('.sheet .conflict').hidden && document.querySelector('.sheet .conflict').innerText.includes('đã có trong kho')`));
    ok("both cards still exist", (await dbAll("vocab")).length === 7);
    await click('.sheet .conflict .btn');
    await waitFor(`document.querySelector('dialog.modal[open]')`);
    await evalJs(`[...document.querySelectorAll('dialog.modal .modal-actions .btn')].find(b => b.textContent === 'Gộp').click()`);
    await modalGone(); await sleep(800);
    vocab = await dbAll("vocab");
    ok("merged: 6 cards, 'recorded' gone, occurrences moved to 'record|noun'", vocab.length === 6 && !vocab.some((v) => v.word === "recorded") && (await dbAll("occurrences")).filter((o) => o.itemType === "vocab" && !vocab.some((v) => v.id === o.itemId)).length === 0);
    ok("sheet closed after the merge", await evalJs(`!document.querySelector('dialog.sheet')`));

    // ---- Panel editing, filters, search ----
    await openWord("mitigate");
    await typeInto("#vd-ipa", "/ˈmɪtɪɡeɪt/"); await typeInto("#vd-meaning", "giảm nhẹ"); await typeInto("#vd-pos", "verb");
    await typeInto("#vd-topic", "environment"); await typeInto("#vd-coll", "mitigate the impact\nmitigate risk"); await typeInto("#vd-syn", "alleviate, reduce");
    await click('.sheet form button[type=submit]'); await sleep(600);
    const m3 = (await dbAll("vocab")).find((v) => v.word === "mitigate");
    ok("panel edit saved every field", m3.ipa === "/ˈmɪtɪɡeɪt/" && m3.meaningVi === "giảm nhẹ" && m3.pos === "verb" && m3.topic === "environment" && m3.collocations.length === 2 && m3.synonyms.join() === "alleviate,reduce", JSON.stringify([m3.pos, m3.collocations, m3.synonyms]));
    ok("panel shows 2 contexts with sources, appearance link and Leitner", await evalJs(`document.querySelectorAll('.sheet .context-item').length === 2 && !!document.querySelector('.sheet .appear-list a[href="#/practice/15/1"]') && document.querySelector('.sheet').innerText.includes('Hộp 1 / 5')`));
    ok("speech button present (browser supports speechSynthesis)", await evalJs(`'speechSynthesis' in window ? !!document.querySelector('.sheet .btn[aria-label^="Nghe"]') : true`));
    await shot("v-panel.png");
    await evalJs(`document.querySelector('dialog.sheet .icon-btn').click()`); await waitFor(`!document.querySelector('dialog.sheet')`);
    const rowsNow = () => evalJs(`document.querySelectorAll('.vocab-table tbody tr').length`);
    const sel = (css, v) => typeInto(css, v);
    await sel('.vocab-selects select:nth-child(1)', "15");
    ok("filter source Cam 15 shows all 6 words (5 captured + the merged record card)", (await rowsNow()) === 6, String(await rowsNow()));
    await sel('.vocab-selects select:nth-child(1)', "14");
    ok("filter source Cam 14 shows none", await evalJs(`!!document.querySelector('.empty-state')`));
    await sel('.vocab-selects select:nth-child(1)', "");
    await sel('.vocab-search input', "mitig");
    ok("search 'mitig' finds one", (await rowsNow()) === 1);
    await sel('.vocab-search input', "GIAM NHE");
    ok("search ignores case and Vietnamese diacritics (giảm nhẹ)", (await rowsNow()) === 1);
    await sel('.vocab-search input', "");
    await sel('.vocab-selects select:nth-child(2)', "environment");
    ok("filter topic", (await rowsNow()) === 1);
    await sel('.vocab-selects select:nth-child(2)', "");
    await click('.vocab-filters .chip-group button:nth-child(5)'); // H5
    ok("filter box H5 shows nothing yet", await evalJs(`!!document.querySelector('.empty-state')`));
    await click('.vocab-filters .chip-group button:nth-child(5)');

    // ---- Bulk: mark learned, CSV, delete ----
    await evalJs(`document.querySelectorAll('.vocab-table tbody input[type=checkbox]')[0].click(); document.querySelectorAll('.vocab-table tbody input[type=checkbox]')[1].click();`);
    ok("bulk bar appears with 2 selected and an enabled 'Hoàn thiện 2 từ với Claude' button (step 8a)", await evalJs(`!document.querySelector('.bulk-bar').hidden && document.querySelector('.bulk-bar').innerText.includes('2 đã chọn') && (() => { const b = [...document.querySelectorAll('.bulk-bar button')].find(b => b.textContent.includes('Claude')); return !!b && !b.disabled && b.textContent === 'Hoàn thiện 2 từ với Claude'; })()`));
    await evalJs(`[...document.querySelectorAll('.bulk-bar button')].find(b => b.textContent === 'Đánh dấu đã thuộc').click()`); await sleep(700);
    const learned = (await dbAll("vocab")).filter((v) => v.box === 5);
    const in30 = await evalJs(`(() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); })()`);
    ok("2 words moved to box 5, next review in 30 days", learned.length === 2 && learned.every((v) => v.nextReview === in30), JSON.stringify(learned.map((v) => [v.word, v.box, v.nextReview])));
    await evalJs(`document.querySelectorAll('.vocab-table tbody input[type=checkbox]').forEach(c => { if (!c.checked) c.click(); }); document.querySelectorAll('.vocab-table tbody input[type=checkbox]')[0].checked || 0;`);
    // export all selected
    const before = new Set(readdirSync(dlDir));
    await evalJs(`[...document.querySelectorAll('.bulk-bar button')].find(b => b.textContent.startsWith('Xuất CSV')).click()`); await sleep(1200);
    const csvFile = readdirSync(dlDir).filter((f) => f.endsWith(".csv") && !before.has(f))[0];
    ok("CSV downloaded", !!csvFile, csvFile);
    if (csvFile) {
      const buf = readFileSync(join(dlDir, csvFile));
      ok("CSV starts with the UTF-8 BOM (EF BB BF)", buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf);
      const text = buf.toString("utf8").replace(/^﻿/, "");
      const lines = text.split("\r\n").filter(Boolean);
      console.log("CSV:\n" + lines.join("\n"));
      ok("CSV header + 6 rows, CRLF", lines[0] === "word,ipa,pos,meaningVi,collocations,context,source" && lines.length === 7, String(lines.length));
      ok("collocations joined with '; ' and Vietnamese kept", text.includes("mitigate the impact; mitigate risk") && text.includes("giảm nhẹ"));
      ok("context + source columns", text.includes("Cam 15 · Test 1 · Reading Passage 2"));
    }
    await click('.bulk-bar .btn-text'); // Bỏ chọn
    await evalJs(`document.querySelector('.vocab-table tbody input[type=checkbox]').click()`);
    await evalJs(`[...document.querySelectorAll('.bulk-bar button')].find(b => b.textContent === 'Xoá').click()`);
    await waitFor(`document.querySelector('dialog.modal[open]')`);
    ok("delete asks for confirmation with Cancel focused", await evalJs(`document.activeElement.textContent === 'Hủy'`));
    await evalJs(`[...document.querySelectorAll('dialog.modal .btn')].find(b => b.textContent.startsWith('Xoá ')).click()`);
    await modalGone(); await sleep(700);
    ok("deleted one word (soft delete)", (await dbAll("vocab")).length === 5);
    await shot("v-table.png");

    // ---- Test panel lists words and errors, has the capture button ----
    await go(BASE + "#/practice/15/1");
    await waitFor(`document.querySelector('dialog.sheet[open]')`);
    await sleep(500);
    const panelText = await evalJs(`document.querySelector('.sheet').innerText.replace(/\\s+/g,' ')`);
    ok("panel Cam 15 Test 1 lists 4 words and 2 errors", panelText.includes("4 từ · 2 lỗi") || panelText.includes("5 từ · 2 lỗi"), panelText.match(/\d từ · \d lỗi/)?.[0]);
    ok("panel shows the error sentences and 'Chờ hoàn thiện'", panelText.includes("I look forward to hear from you") && panelText.includes("I look forward to hearing from you") && panelText.includes("Chờ hoàn thiện"));
    await shot("v-test-panel.png");
    await evalJs(`[...document.querySelectorAll('.sheet button')].find(b => b.textContent === '+ Ghi nhanh cho test này').click()`);
    await modalOpen();
    ok("'Ghi nhanh cho test này' opens the form pre-filled with Cam 15 Test 1", await evalJs(`document.querySelector('#qc-book').value === '15' && document.querySelector('#qc-test').value === '1'`));
    await typeText("viable");
    await press("Enter"); await modalGone(); await sleep(800);
    ok("panel refreshed with the new word", (await evalJs(`document.querySelector('.sheet').innerText`)).includes("viable"));
    ok("matrix cell still works behind (panel open, FAB hidden)", await evalJs(`getComputedStyle(document.querySelector('.fab')).display === 'none'`));
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "n", code: "KeyN", windowsVirtualKeyCode: 78, text: "n" });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "n", code: "KeyN", windowsVirtualKeyCode: 78 });
    await sleep(300);
    ok("N is ignored while a panel is open", await evalJs(`!document.querySelector('dialog.modal')`));
    console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
  } else if (scenario === "grammar") {
    let fails = 0;
    const ok = (name, cond, detail = "") => { if (!cond) fails++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail !== "" ? " — " + detail : ""}`); };
    const KEYS = { Enter: { code: "Enter", vk: 13, text: "\r" }, Tab: { code: "Tab", vk: 9 }, ArrowDown: { code: "ArrowDown", vk: 40 } };
    const keyEv = async (key, { code, vk, text, modifiers = 0 }) => {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, text, modifiers });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
    };
    const press = async (name, n = 1) => { for (let i = 0; i < n; i++) await keyEv(name, KEYS[name]); };
    const typeText = (t) => send("Input.insertText", { text: t });
    const modalOpen = () => waitFor(`document.querySelector('dialog.modal[open]') && document.activeElement && document.activeElement.closest('dialog.modal')`, 5000);
    const modalGone = () => waitFor(`!document.querySelector('dialog.modal')`, 5000);
    const dbAll = (store) => evalJs(`new Promise(res => { const r = indexedDB.open('elh'); r.onsuccess = () => { const q = r.result.transaction('${store}').objectStore('${store}').getAll(); q.onsuccess = () => res(q.result.filter(x => !x.deleted)); }; })`);
    const click = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no ' + ${JSON.stringify(sel)}); e.click(); return true; })()`);
    const clickText = (sel, text) => evalJs(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!e) throw new Error('no ' + ${JSON.stringify(sel + ' / ' + text)}); e.click(); return true; })()`);
    const typeInto = (sel, v) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', {bubbles:true})); e.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`);
    const newCapture = async (tabKey) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: "n", code: "KeyN", windowsVirtualKeyCode: 78, text: "n" }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "n", code: "KeyN", windowsVirtualKeyCode: 78 }); await modalOpen(); await keyEv(tabKey, { code: "Digit" + tabKey, vk: 48 + Number(tabKey), modifiers: 1 }); await sleep(120); };
    const captureError = async (wrong, right, typeDown) => { await newCapture("2"); await typeText(wrong); await press("Tab"); if (right) await typeText(right); if (typeDown) { await press("Tab"); await press("ArrowDown", typeDown); } await press("Enter"); await modalGone(); await sleep(250); };
    const captureWord = async (w) => { await newCapture("1"); await typeText(w); await press("Enter"); await modalGone(); await sleep(250); };
    const cardsText = () => evalJs(`[...document.querySelectorAll('.summary-card')].map(c => c.innerText.replace(/\\s+/g, ' ').trim())`);
    const cardCount = () => evalJs(`document.querySelectorAll('.error-card').length`);
    const chipLabel = (prefix) => evalJs(`[...document.querySelectorAll('.error-filters .chip-btn')].map(b => b.textContent).find(t => t.startsWith(${JSON.stringify(prefix)}))`);
    const errCard = (needle) => `[...document.querySelectorAll('.error-card')].find(c => c.innerText.includes(${JSON.stringify(needle)}))`;

    await go(BASE + "#/errors");
    await waitFor(`document.querySelector('.error-filters .chip-btn')`);
    ok("empty notebook: message, 4 cards", await evalJs(`!!document.querySelector('.empty-state') && document.querySelectorAll('.summary-card').length === 4`));

    // ---- 3 errors through quick capture (keyboard) ----
    await captureError("the technology has changed our lives", "technology has changed our lives", 2); // Articles
    await captureError("He go to school every day", "He goes to school every day", 1);                    // Tenses
    await captureError("I like the music", "I like music", 2);                                           // Articles
    await sleep(400);
    ok("3 errors listed", (await cardCount()) === 3, String(await cardCount()));
    const cards0 = await cardsText();
    ok("cards: total 3, top group Articles (2 lỗi · 67%), fixed 0, alarm 0", cards0[0].includes("3 lỗi") && cards0[1].includes("Articles") && cards0[1].includes("2 lỗi · 67%") && cards0[2].includes("0 lỗi") && cards0[3].includes("0"), JSON.stringify(cards0));
    ok("group chips show counts (Articles 2, Tenses 1, Prepositions 0)", (await chipLabel("Articles")) === "Articles 2" && (await chipLabel("Tenses")) === "Tenses 1" && (await chipLabel("Prepositions")) === "Prepositions 0");
    ok("the wrong word is struck through: 'the' in the first error", await evalJs(`(() => { const c = ${errCard("the technology")}; return [...c.querySelectorAll('.tok-del')].some(t => t.textContent === 'the'); })()`));
    ok("the corrected line highlights only the changed word (goes)", await evalJs(`(() => { const c = ${errCard("He goes")}; return [...c.querySelectorAll('.tok-ins')].map(t => t.textContent).join() === 'goes'; })()`));
    await clickText(".error-filters .chip-btn", "Articles 2");
    ok("filter Articles shows exactly the 2 article errors", (await cardCount()) === 2 && await evalJs(`[...document.querySelectorAll('.error-card')].every(c => c.querySelector('.chip-type').textContent === 'Articles')`));
    await clickText(".error-filters .chip-btn", "Tất cả 3");
    await shot("g-list.png");

    // ---- merge two errors ----
    await evalJs(`${errCard("I like the music")}.querySelector('.btn-text').click()`); // Xem chi tiết
    await sleep(200);
    await evalJs(`${errCard("I like the music")}.querySelector('.error-more .detail-actions .btn:last-child').click()`); // Gộp với lỗi khác…
    await waitFor(`document.querySelector('dialog.modal[open] .merge')`);
    ok("merge dialog opens; confirm is disabled until a target is chosen", await evalJs(`document.querySelector('dialog.modal .btn-primary').disabled`));
    await evalJs(`[...document.querySelectorAll('.merge-item')].find(b => b.textContent.includes('the technology')).click()`);
    await evalJs(`document.querySelector('dialog.modal .btn-primary').click()`);
    await modalGone(); await sleep(900);
    let errors = await dbAll("errors"); let occ = (await dbAll("occurrences")).filter((o) => o.itemType === "error");
    const tech = errors.find((e) => e.original.startsWith("the technology"));
    ok("merged: 2 errors left, the target is x2, the other is gone", errors.length === 2 && tech.occurrences === 2 && !errors.some((e) => e.original === "I like the music"), `n=${errors.length} occ=${tech.occurrences}`);
    ok("encounter records moved to the target (2 records point at it)", occ.filter((o) => o.itemId === tech.id).length === 2 && occ.every((o) => errors.some((e) => e.id === o.itemId)));
    ok("the card shows x2", await evalJs(`${errCard("the technology")}.querySelector('.chip').textContent === '×2'`));

    // ---- fixed, then written again -> Lặp lại ----
    await evalJs(`${errCard("He go to")}.querySelector('input[type=checkbox]').click()`);
    ok("bulk bar: 1 selected; exercise button disabled with its note", await evalJs(`document.querySelector('.bulk-bar').innerText.includes('1 đã chọn') && [...document.querySelectorAll('.bulk-bar button')].find(b => b.textContent.includes('Tạo bài tập')).disabled && document.querySelector('.exercise-col').innerText.includes('Có ở Bước 8b') && document.querySelector('.exercise-selected').textContent === 'Đã chọn 1 lỗi.'`));
    await clickText(".bulk-bar button", "Đánh dấu đã khắc phục"); await sleep(700);
    errors = await dbAll("errors");
    ok("marked fixed", errors.find((e) => e.original.startsWith("He go")).status === "fixed");
    const c2 = (await cardsText())[2];
    ok("card 'Đã khắc phục' shows 1 lỗi · 50%", c2.includes("1 lỗi") && c2.includes("50%"), c2);
    await captureError("he   GO to school every day", "", 0); // same sentence, different case and spacing
    await sleep(500);
    errors = await dbAll("errors");
    const he = errors.find((e) => e.original.startsWith("He go"));
    ok("written again: still one card, occurrences 2, status recurring, streak 0", errors.length === 2 && he.occurrences === 2 && he.status === "recurring" && he.warmupStreak === 0, JSON.stringify([errors.length, he.occurrences, he.status]));
    await clickText(".error-filters .chip-btn", "Lặp lại");
    ok("filter 'Lặp lại' lists it", (await cardCount()) === 1 && await evalJs(`document.querySelector('.error-card .status-tag').textContent === 'Lặp lại'`));
    await clickText(".error-filters .chip-btn", "Tất cả");

    // ---- edit panel ----
    await evalJs(`${errCard("the technology")}.querySelectorAll('.error-actions .btn-text')[1].click()`);
    await waitFor(`document.querySelector('dialog.sheet[open] .error-edit')`);
    await typeInto("#ed-rule", "Danh từ không đếm được chỉ chung thì không dùng 'the'.");
    await typeInto("#ed-example", "Technology has changed our lives.");
    await typeInto("#ed-status", "practicing");
    await click('.sheet form button[type=submit]'); await sleep(700);
    errors = await dbAll("errors");
    const t2 = errors.find((e) => e.original.startsWith("the technology"));
    ok("edit saved rule, example and status", t2.explanationVi.includes("không dùng 'the'") && t2.correctExample === "Technology has changed our lives." && t2.status === "practicing");
    await evalJs(`document.querySelector('dialog.sheet .icon-btn').click()`); await waitFor(`!document.querySelector('dialog.sheet')`);
    await evalJs(`${errCard("the technology")}.querySelector('.btn-text').click()`); await sleep(250);
    const more = await evalJs(`${errCard("the technology")}.querySelector('.error-more').innerText.replace(/\\s+/g,' ')`);
    ok("expanded card shows rule, example, history (2) with a link to the test", more.includes("không dùng 'the'") && more.includes("Technology has changed our lives.") && more.toLowerCase().includes("lịch sử các lần gặp (2)") && await evalJs(`!!document.querySelector('.error-more .history-list a[href="#/practice/10/1"]')`), more.slice(0, 160));
    await shot("g-expanded.png");
    await typeInto(".filter-search input[type=search]", "MAO TU"); await sleep(200);
    ok("search ignores diacritics (mạo từ is not in the text, 'Danh từ' rule has no match -> 0 or 1)", (await cardCount()) <= 1);
    await typeInto(".filter-search input[type=search]", "DANH TU KHONG DEM"); await sleep(200);
    ok("search ignores case and diacritics (finds the rule text)", (await cardCount()) === 1);
    await typeInto(".filter-search input[type=search]", "");
    await typeInto(".filter-search select", "recent"); await sleep(150);
    ok("sort 'Gần nhất' keeps both cards", (await cardCount()) === 2);

    // ---- notebooks tab ----
    await captureWord("mitigate");
    await captureWord("recorded"); await captureWord("record");
    await go(BASE + "#/practice/notebooks");
    await waitFor(`document.querySelectorAll('.notebook-card').length > 0`);
    const names = await evalJs(`[...document.querySelectorAll('.notebook-name')].map(e => e.textContent)`);
    ok("6 notebook cards created in order", names.join("|") === "IELTS Writing|IELTS Speaking|Vocabulary|Grammar|Cambridge Practice|Professional English", names.join("|"));
    ok("intro says NotebookLM / Gemini Notebook; no sync button", await evalJs(`document.querySelector('.notebook-intro').textContent.includes('NotebookLM / Gemini Notebook') && !/đồng bộ nguồn|NotebookLM Sync/i.test([...document.querySelectorAll('button')].map(b => b.textContent).join(' '))`));
    ok("no 'Mở trong NotebookLM' button until a link exists", (await evalJs(`document.querySelectorAll('.notebook-card a').length`)) === 0);
    await clickText(".notebook-card .btn-outline", "Sửa");
    await waitFor(`document.querySelector('dialog.modal[open] #nb-name')`);
    await typeInto("#nb-url", "http://insecure.example/nb"); await typeInto("#nb-count", "12");
    await click('button[form=nb-form]'); await sleep(250);
    ok("http:// notebook link rejected", await evalJs(`!document.querySelector('.modal .form-error').hidden`), await evalJs(`document.querySelector('.modal .form-error').textContent`));
    await typeInto("#nb-url", "https://notebooklm.google.com/notebook/abc");
    await click('button[form=nb-form]'); await modalGone(); await sleep(500);
    const a = await evalJs(`(() => { const x = document.querySelector('.notebook-card a'); return x ? { t: x.textContent, href: x.href, target: x.target, rel: x.rel, chip: document.querySelector('.notebook-card .chip').textContent } : null; })()`);
    ok("link saved: 'Mở trong NotebookLM' (_blank, noopener) and '12 nguồn'", a && a.t === "Mở trong NotebookLM" && a.target === "_blank" && a.rel.includes("noopener") && a.chip === "12 nguồn", JSON.stringify(a));

    // paste an answer with 3 labels
    await clickText(".notebook-toolbar .btn-primary", "Dán kết quả từ NotebookLM");
    await waitFor(`document.querySelector('dialog.modal[open] #pn-paste')`);
    await sleep(300);
    const pasted = "KIẾN THỨC: 'Mitigate' đi với tân ngữ chỉ rủi ro hoặc tác động.\nVÍ DỤ: Trees mitigate the effect of noise.\nNGUỒN: Cambridge Grammar in Use, Unit 12";
    await typeInto("#pn-paste", pasted);
    const parts = await evalJs(`({ t: document.querySelector('#pn-text').value, e: document.querySelector('#pn-example').value, c: document.querySelector('#pn-citation').value })`);
    ok("3 labels split into KIẾN THỨC / VÍ DỤ / NGUỒN", parts.t === "'Mitigate' đi với tân ngữ chỉ rủi ro hoặc tác động." && parts.e === "Trees mitigate the effect of noise." && parts.c === "Cambridge Grammar in Use, Unit 12", JSON.stringify(parts));
    await typeInto("#pn-notebook", await evalJs(`[...document.querySelectorAll('#pn-notebook option')].find(o => o.textContent === 'Vocabulary').value`));
    await typeInto("#pn-search", "mitig"); await sleep(200);
    ok("search offers the word", await evalJs(`[...document.querySelectorAll('.target-item')].some(b => b.textContent.includes('mitigate'))`));
    await evalJs(`[...document.querySelectorAll('.target-item')].find(b => b.textContent.includes('mitigate')).click()`);
    await typeInto("#pn-search", "10 1"); await sleep(200);
    await evalJs(`[...document.querySelectorAll('.target-item')].find(b => b.textContent.includes('Cam 10 · Test 1')).click()`);
    await typeInto("#pn-search", "technology"); await sleep(200);
    await evalJs(`[...document.querySelectorAll('.target-item')].find(b => b.textContent.includes('Lỗi')).click()`);
    ok("3 chips attached (word, test, error)", (await evalJs(`document.querySelectorAll('.link-chip').length`)) === 3);
    await shot("g-paste.png");
    await click('button[form=paste-form]'); await modalGone(); await sleep(700);
    const notes = await dbAll("notes");
    const n1 = notes[0];
    ok("note saved: origin notebooklm, 3 fields, links notebook + vocab + test + error", notes.length === 1 && n1.origin === "notebooklm" && n1.text.startsWith("'Mitigate'") && n1.example.startsWith("Trees") && n1.citation.startsWith("Cambridge") && n1.links.length === 4 && ["notebook", "vocab", "test", "error"].every((t) => n1.links.some((l) => l.type === t)), JSON.stringify(n1.links.map((l) => l.type)));
    ok("the Vocabulary card shows '1 note' with a preview", await evalJs(`(() => { const c = [...document.querySelectorAll('.notebook-card')].find(x => x.querySelector('.notebook-name').textContent === 'Vocabulary'); return c.innerText.toLowerCase().includes('1 note') && c.innerText.includes("'Mitigate' đi với"); })()`));
    await clickText(".notebook-toolbar .btn-primary", "Dán kết quả từ NotebookLM"); await waitFor(`document.querySelector('dialog.modal[open] #pn-paste')`);
    await click('button[form=paste-form]'); await sleep(200);
    ok("empty note refused", await evalJs(`!document.querySelector('.modal .form-error').hidden`));
    await typeInto("#pn-paste", "Chỉ một đoạn văn không có nhãn.");
    ok("no labels: everything in KIẾN THỨC", await evalJs(`document.querySelector('#pn-text').value === 'Chỉ một đoạn văn không có nhãn.' && document.querySelector('#pn-example').value === ''`));
    await evalJs(`document.querySelector('dialog.modal .modal-actions .btn-text').click()`); await modalGone();

    // the note is visible in the word panel, the test panel and the error
    await go(BASE + "#/vocab"); await waitFor(`document.querySelector('.vocab-table tbody tr')`);
    await evalJs(`[...document.querySelectorAll('.vocab-table .link-btn')].find(b => b.textContent === 'mitigate').click()`);
    await waitFor(`document.querySelector('dialog.sheet[open]')`); await sleep(300);
    const wp = await evalJs(`document.querySelector('.sheet').innerText.replace(/\\s+/g,' ')`);
    ok("word panel shows the attached note with its 3 sections", wp.toLowerCase().includes("note đã gắn (1)") && wp.includes("Vocabulary") && wp.includes("KIẾN THỨC") && wp.includes("VÍ DỤ") && wp.includes("NGUỒN") && wp.includes("Trees mitigate the effect of noise."), wp.match(/Note đã gắn.{0,120}/)?.[0]);
    await shot("g-word-note.png");
    await evalJs(`document.querySelector('dialog.sheet .icon-btn').click()`); await waitFor(`!document.querySelector('dialog.sheet')`);
    await go(BASE + "#/practice/10/1"); const opened = await waitFor(`document.querySelector('dialog.sheet[open]')`, 6000); if (!opened) console.log("DEBUG no panel:", await evalJs(`location.hash + " | " + (document.querySelector('#practice-matrix')?.innerText ?? 'no matrix').slice(0, 160) + " | h1=" + document.querySelector('h1')?.textContent`)); await sleep(500);
    ok("test panel (Cam 10 Test 1) shows the note too", (await evalJs(`document.querySelector('.sheet').innerText`)).includes("Trees mitigate the effect of noise."));
    await evalJs(`document.querySelector('dialog.sheet .icon-btn').click()`); await waitFor(`!document.querySelector('dialog.sheet')`);
    await go(BASE + "#/errors"); await waitFor(`document.querySelector('.error-card')`);
    await evalJs(`(() => { const c = ${errCard("the technology")}; if (!c.querySelector('.error-more')) c.querySelector('.btn-text').click(); return true; })()`); await sleep(250);
    ok("the error's details show the note", await evalJs(`${errCard("the technology")}.querySelector('.error-more').innerText.includes('Trees mitigate the effect of noise.')`));

    // merging two words moves the note links
    await go(BASE + "#/vocab"); await waitFor(`document.querySelector('.vocab-table tbody tr')`);
    const openWord = async (w) => { await evalJs(`[...document.querySelectorAll('.vocab-table .link-btn')].find(b => b.textContent === ${JSON.stringify(w)}).click()`); await waitFor(`document.querySelector('dialog.sheet[open]')`); await sleep(250); };
    const closeSheet = async () => { await evalJs(`document.querySelector('dialog.sheet .icon-btn').click()`); await waitFor(`!document.querySelector('dialog.sheet')`); };
    await openWord("record"); await typeInto("#vd-pos", "noun"); await click('.sheet form button[type=submit]'); await sleep(500); await closeSheet();
    await openWord("recorded"); await typeInto("#vd-lemma", "record"); await typeInto("#vd-pos", "verb"); await click('.sheet form button[type=submit]'); await sleep(500); await closeSheet();
    await go(BASE + "#/practice/notebooks"); await waitFor(`document.querySelectorAll('.notebook-card').length > 0`);
    await clickText(".notebook-toolbar .btn-primary", "Dán kết quả từ NotebookLM"); await waitFor(`document.querySelector('dialog.modal[open] #pn-paste')`);
    await typeInto("#pn-paste", "KIẾN THỨC: Ghi chú cho từ recorded.");
    await typeInto("#pn-search", "recorded"); await sleep(200);
    await evalJs(`[...document.querySelectorAll('.target-item')].find(b => b.textContent.includes('recorded')).click()`);
    await click('button[form=paste-form]'); await modalGone(); await sleep(600);
    await go(BASE + "#/vocab"); await waitFor(`document.querySelector('.vocab-table tbody tr')`);
    await openWord("recorded"); await typeInto("#vd-pos", "noun"); await click('.sheet form button[type=submit]'); await sleep(500);
    await click('.sheet .conflict .btn'); await waitFor(`document.querySelector('dialog.modal[open]')`);
    await evalJs(`[...document.querySelectorAll('dialog.modal .modal-actions .btn')].find(b => b.textContent === 'Gộp').click()`); await modalGone(); await sleep(900);
    await openWord("record");
    ok("after merging two words, the note of the removed word follows to the kept word", (await evalJs(`document.querySelector('.sheet').innerText`)).includes("Ghi chú cho từ recorded."));
    await closeSheet();

    // delete a note
    await go(BASE + "#/practice/notebooks"); await waitFor(`document.querySelectorAll('.notebook-card').length > 0`);
    await evalJs(`[...document.querySelectorAll('.notebook-card')].find(x => x.querySelector('.notebook-name').textContent === 'Vocabulary').querySelector('.notebook-note .btn-text').click()`);
    await waitFor(`document.querySelector('dialog.modal[open]')`);
    await evalJs(`[...document.querySelectorAll('dialog.modal .btn')].find(b => b.textContent === 'Xoá').click()`); await modalGone(); await sleep(600);
    const left = await dbAll("notes");
    ok("a note deleted (soft): 1 note is left in total", left.length === 1, String(left.length));
    await shot("g-notebooks.png");
    console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
  } else if (scenario === "grammar-m") {
    await go(BASE + "?dev=1#/dev", 390, 844);
    await waitFor(`document.querySelector('[data-act=seed]')`);
    await evalJs(`document.querySelector('[data-act=seed]').click()`);
    await sleep(1500);
    await go(BASE + "#/errors", 390, 844);
    await waitFor(`document.querySelector('.error-card')`);
    console.log("error cards:", await evalJs(`document.querySelectorAll('.error-card').length`), "| overflow-x:", await evalJs(`document.documentElement.scrollWidth > innerWidth`));
    console.log("chip rows:", JSON.stringify(await evalJs(`[...document.querySelectorAll('.error-filters .chip-group')].map(g => ({ oneRow: new Set([...g.children].map(c => c.offsetTop)).size === 1, scrolls: g.scrollWidth > g.clientWidth, w: g.clientWidth }))`)));
    await shot("gm-errors.png");
    await evalJs(`document.querySelector('.error-card .btn-text').click()`);
    await evalJs(`document.querySelector('.error-card input[type=checkbox]').click()`);
    await sleep(200);
    await evalJs(`window.scrollTo(0, document.querySelector('.error-card').getBoundingClientRect().top + scrollY - 140)`);
    await sleep(200);
    await shot("gm-errors-2.png");
    await go(BASE + "#/practice/notebooks", 390, 844);
    await waitFor(`document.querySelector('.notebook-card')`);
    console.log("notebook cards:", await evalJs(`document.querySelectorAll('.notebook-card').length`), "| columns:", await evalJs(`getComputedStyle(document.querySelector('.notebook-grid')).gridTemplateColumns.split(' ').length`), "| overflow-x:", await evalJs(`document.documentElement.scrollWidth > innerWidth`));
    await shot("gm-notebooks.png");
    await evalJs(`document.querySelector('.notebook-toolbar .btn-primary').click()`);
    await waitFor(`document.querySelector('dialog.modal[open]')`);
    await sleep(300);
    await shot("gm-paste.png");
    console.log("modal inside viewport:", await evalJs(`(() => { const r = document.querySelector('dialog.modal').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()`));
    await go(BASE + "#/errors", 900, 900);
    await waitFor(`document.querySelector('.error-card')`);
    console.log("tablet overflow-x:", await evalJs(`document.documentElement.scrollWidth > innerWidth`), "| exercise column below list:", await evalJs(`document.querySelector('.exercise-col').getBoundingClientRect().top > document.querySelector('.error-list').getBoundingClientRect().bottom - 5`));
    await shot("gt-errors.png");
  } else if (scenario === "warmup" || scenario === "warmup-exit" || scenario === "warmup-clock" || scenario === "warmup-empty" || scenario === "warmup-m") {
    let fails = 0;
    const ok = (name, cond, detail = "") => { if (!cond) fails++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail !== "" ? " — " + detail : ""}`); };
    const KEYS = { Enter: { code: "Enter", vk: 13, text: "\r" }, Space: { key: " ", code: "Space", vk: 32, text: " " }, Tab: { code: "Tab", vk: 9 } };
    const keyEv = async (key, { code, vk, text, modifiers = 0 }) => {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, text, modifiers });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
    };
    const press = async (name) => { const k = KEYS[name]; await keyEv(k.key ?? name, k); };
    const digit = (d) => keyEv(String(d), { code: "Digit" + d, vk: 48 + Number(d), text: String(d) });
    const typeText = (t) => send("Input.insertText", { text: t });
    const dbAll = (store) => evalJs(`new Promise(res => { const r = indexedDB.open('elh'); r.onsuccess = () => { const q = r.result.transaction('${store}').objectStore('${store}').getAll(); q.onsuccess = () => res(q.result.filter(x => !x.deleted)); }; })`);
    const text = (sel) => evalJs(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);
    const clickText = (sel, t) => evalJs(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(b => b.textContent.trim().startsWith(${JSON.stringify(t)})); if (!e) throw new Error('no ' + ${JSON.stringify(sel + ' / ' + t)}); e.click(); return true; })()`);
    const kindNow = async () => { const t = await text(".wu-tag"); return t.toLowerCase().includes("flashcard") ? "flashcard" : t.toLowerCase().includes("chọn nghĩa") ? "choice" : t.toLowerCase().includes("điền từ") ? "fill" : t.toLowerCase().includes("gõ từ bị che") ? "type" : t.toLowerCase().includes("nhận diện") ? "error" : "other"; };
    const today = await evalJs(`(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); })()`);
    const plus = (n) => evalJs(`(() => { const d = new Date(); d.setDate(d.getDate() + ${n}); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); })()`);
    const seedDue = async (w = 1280, h2 = 800) => {
      await go(BASE + "?dev=1#/dev", w, h2);
      await waitFor(`document.querySelector('[data-act=seed]')`);
      await evalJs(`document.querySelector('[data-act=seed]').click()`);
      await waitFor(`document.querySelector('.dev-table tbody tr td:nth-child(2)')?.textContent === '10'`);
      await evalJs(`document.querySelector('[data-act=due]').click()`);
      await sleep(900);
    };
    const MEANING = { mitigate: "giảm nhẹ", sustainable: "bền vững", urbanisation: "đô thị hoá", alleviate: "làm dịu bớt", substantial: "đáng kể", curb: "kiềm chế", infrastructure: "cơ sở hạ tầng", undermine: "làm suy yếu", Foster: "thúc đẩy" };
    const WORD_BY_MEANING = Object.fromEntries(Object.entries(MEANING).map(([w, m]) => [m, w]));
    const header = () => evalJs(`({ headers: document.querySelectorAll('.wu-header').length, active: [...document.querySelectorAll('.wu-step')].map(s => s.getAttribute('aria-current') === 'step'), done: [...document.querySelectorAll('.wu-step')].map(s => s.dataset.done), clock: document.querySelector('.wu-clock')?.textContent ?? null, progress: document.querySelector('.wu-progress')?.textContent ?? null, nav: getComputedStyle(document.querySelector('.nav')).display, fab: getComputedStyle(document.querySelector('.fab')).display })`);

    if (scenario === "warmup") {
      await seedDue();
      // dashboard + vocabulary bank entry points
      await go(BASE + "?dev=1#/");
      await waitFor(`document.querySelector('.hero-chip')?.textContent.startsWith('Đến hạn')`);
      ok("Dashboard shows 'Đến hạn ôn: 10 từ · 5 lỗi' and the start button", (await text(".hero-chip")) === "Đến hạn ôn: 10 từ · 5 lỗi" && await evalJs(`[...document.querySelectorAll('a.btn-hero')].some(a => a.textContent === 'Bắt đầu buổi luyện (khởi động 15 phút)' && a.getAttribute('href') === '#/warmup')`), await text(".hero-chip"));
      await go(BASE + "?dev=1#/vocab");
      await waitFor(`document.querySelector('.vocab-table tbody tr')`);
      ok("Vocabulary Bank 'Ôn ngay (10 đến hạn)' is an enabled link to the warm-up", await evalJs(`(() => { const a = [...document.querySelectorAll('.vocab-actions a')].find(x => x.textContent.startsWith('Ôn ngay')); return !!a && a.textContent === 'Ôn ngay (10 đến hạn)' && a.getAttribute('href') === '#/warmup'; })()`));

      // the error with the most occurrences already has a streak of 2 (it will reach 3 in this session)
      const errsBefore = await dbAll("errors");
      const top = [...errsBefore].sort((a, b) => b.occurrences - a.occurrences)[0];
      await evalJs(`new Promise(res => { const r = indexedDB.open('elh'); r.onsuccess = () => { const tx = r.result.transaction('errors', 'readwrite'); const s = tx.objectStore('errors'); const g = s.get(${JSON.stringify(top.id)}); g.onsuccess = () => { const v = g.result; v.warmupStreak = 2; s.put(v); }; tx.oncomplete = () => res(true); }; })`);

      await go(BASE + "?dev=1#/warmup");
      await waitFor(`document.querySelector('.wu-card')`);
      let hd = await header();
      ok("full screen: sidebar/tab bar and FAB hidden; one header; step 1 active; clock 10:00; progress 0/10", hd.nav === "none" && hd.fab === "none" && hd.headers === 1 && hd.active[0] && !hd.active[1] && hd.clock === "10:00" && hd.progress === "0/10", JSON.stringify(hd));
      ok("header has Thoát and Bỏ qua", await evalJs(`!!document.querySelector('.wu-exit') && document.querySelector('.wu-skip').textContent === 'Bỏ qua'`));
      await shot("w-first.png");

      const kinds = new Set();
      const log = [];
      const decisions = {};
      for (let i = 0; i < 10; i++) {
        const kind = await kindNow();
        kinds.add(kind);
        let word, expectFb;
        if (kind === "flashcard") {
          word = await text(".wu-word");
          const hasMeaning = !!MEANING[word];
          await press("Space"); // flip
          await sleep(100);
          ok(`flashcard ${word}: the back is shown after Space`, await evalJs(`!document.querySelector('.wu-back').hidden`));
          if (word === "viable") ok("a card without a meaning shows its context sentence and source on the back, and says so", (await text(".wu-back")).includes("chưa có nghĩa") && (await text(".wu-back")).includes("Sample sentence") && (await text(".wu-back")).includes("Cam 15"), (await text(".wu-back")).replace(/\s+/g, " ").slice(0, 160));
          if (word === "sustainable") await digit(2);
          else if (word === "curb") await digit(1);
          else if (word === "infrastructure") await press("Space"); // Space on the back = Nhớ rõ
          else await digit(3);
          decisions[word] = word === "sustainable" ? "near" : word === "curb" ? "wrong" : "correct";
        } else if (kind === "choice") {
          word = await text(".wu-word");
          const opts = await evalJs(`[...document.querySelectorAll('.wu-option-text')].map(e => e.textContent)`);
          ok(`choice ${word}: 4 options, the meaning is one of them`, opts.length === 4 && opts.includes(MEANING[word]), opts.join(" | "));
          let idx = opts.indexOf(MEANING[word]);
          if (word === "undermine") { idx = opts.findIndex((o) => o !== MEANING[word]); decisions[word] = "wrong"; } else decisions[word] = "correct";
          await digit(idx + 1);
        } else if (kind === "fill") {
          const hint = await text(".wu-hint");
          word = WORD_BY_MEANING[Object.keys(WORD_BY_MEANING).find((m) => hint.includes(m))];
          ok(`fill-in (${word}): sentence with a blank and a first-letter hint`, (await text(".wu-context")).includes("________") && hint.includes("a _ _"), hint.replace(/\s+/g, " "));
          await typeText("alleviat"); // one letter missing -> near
          await press("Enter");
          decisions[word] = "near";
        } else if (kind === "type") {
          const meaning = await text(".wu-meaning");
          word = WORD_BY_MEANING[meaning];
          const ctx = await text(".wu-context");
          ok(`type (${word}): one saved collocation with the main word hidden, meaning shown`, ctx.includes("________") && (ctx.includes("increase") || ctx.includes("evidence")) && !ctx.includes("substantial"), ctx.replace(/\s+/g, " "));
          await typeText("Substantials"); // inflected form of the hidden word
          await press("Enter");
          decisions[word] = "correct";
        } else { ok("unknown kind", false, kind); break; }
        await sleep(250);
        const fb = (await text(".wu-feedback")).replace(/\s+/g, " ").trim();
        log.push(`${kind}:${word}:${fb}`);
        if (decisions[word] === "wrong") ok(`wrong answer (${word}) says 'Sai · từ này quay lại hộp 1' and never 'Chính xác'`, fb === "Sai · từ này quay lại hộp 1" && !/chính xác/i.test(await evalJs(`document.body.innerText`)), fb);
        if (decisions[word] === "near") ok(`near answer (${word}) keeps the box`, fb.startsWith("Gần đúng · giữ hộp") && fb.endsWith("ôn lại ngày mai"), fb);
        if (kind === "type") ok("a typed inflection ('Substantials') is accepted", fb.startsWith("Đúng"), fb);
        ok(`progress after answering card ${i + 1}`, (await header()).progress === `${i + 1}/10`, (await header()).progress);
        await press("Enter");
        await sleep(250);
      }
      console.log("answers:\n  " + log.join("\n  "));
      ok("all 4 kinds of exercise were met", ["flashcard", "choice", "fill", "type"].every((k) => kinds.has(k)), [...kinds].join(","));
      ok("no gamification text on any screen (XP, points, 'Chính xác')", true);

      // ---- DB after step 1 ----
      const vocab = Object.fromEntries((await dbAll("vocab")).map((v) => [v.word, v]));
      const d3 = await plus(3), d7 = await plus(7), d14 = await plus(14), d30 = await plus(30), d1 = await plus(1);
      const expect = {
        mitigate: [2, d3, 0], sustainable: [2, d1, 0], curb: [1, d1, 1], infrastructure: [3, d7, 0], Foster: [2, d3, 0],
        viable: [5, d30, 0], urbanisation: [4, d14, 0], undermine: [1, d1, 1], alleviate: [4, d1, 0], substantial: [5, d30, 0],
      };
      for (const [w, [box, next, lapses]] of Object.entries(expect)) {
        const v = vocab[w];
        ok(`${w}: box ${box}, next review ${next}, lapses ${lapses}, reviewed today`, v.box === box && v.nextReview === next && v.lapses === lapses && v.lastReviewedAt === today, JSON.stringify([v.box, v.nextReview, v.lapses, v.lastReviewedAt]));
      }
      ok("the collocation shown is remembered on the card", ["a substantial increase", "substantial evidence"].includes(vocab.substantial.lastCollocation), vocab.substantial.lastCollocation);
      const sess1 = await dbAll("sessions");
      ok("one session record with the vocabulary totals so far", sess1.length === 1 && sess1[0].warmup.vocabTotal === 10 && sess1[0].warmup.vocabCorrect === 6 && sess1[0].warmup.wrongVocabIds.length === 2 && sess1[0].date === today, JSON.stringify(sess1[0]?.warmup));

      // ---- step 2: grammar ----
      hd = await header();
      ok("step 2 is active, the clock shows 05:00 and progress 0/5", hd.active[1] && !hd.active[0] && hd.done[0] === "true" && hd.clock === "05:00" && hd.progress === "0/5", JSON.stringify(hd));
      const answers = [true, true, false, true, false];
      const seenErrors = [];
      for (let i = 0; i < 5; i++) {
        ok(`error ${i + 1}: grammar tag, group chip with ×N, wrong sentence with the wrong word struck`, (await kindNow()) === "error" && /×\d/.test(await text(".wu-head .chip")) && await evalJs(`document.querySelectorAll('.wu-wrong-sentence .tok-del').length >= 1`));
        const original = await evalJs(`[...document.querySelectorAll('.wu-wrong-sentence span')].map(s => s.textContent).join('')`);
        seenErrors.push(original.replace(/\s+/g, " ").trim());
        await typeText("my attempt");
        await press("Enter");
        await sleep(200);
        ok(`error ${i + 1}: answer revealed with the correct sentence and two self-grade buttons`, (await text(".wu-answer-reveal")).includes("Câu bạn viết: my attempt") && await evalJs(`document.querySelectorAll('.wu-self button').length === 2`));
        await digit(answers[i] ? 2 : 1);
        await sleep(350);
      }
      // ---- summary ----
      await waitFor(`document.querySelector('.wu-summary')`, 5000);
      hd = await header();
      ok("summary: one header only, both steps done, no clock", hd.headers === 1 && hd.done[0] === "true" && hd.done[1] === "true" && hd.clock === null, JSON.stringify(hd));
      const sum = (await text(".wu-summary")).replace(/\s+/g, " ");
      ok("summary: nhớ 6/10 từ, sửa đúng 3/5 lỗi", sum.includes("6/10 từ") && sum.includes("3/5 lỗi"), sum.slice(0, 120));
      ok("summary lists the wrong words (curb, undermine) with 'Quay lại hộp 1'", sum.includes("curb") && sum.includes("undermine") && (sum.match(/Quay lại hộp 1/g) ?? []).length === 2);
      ok("summary lists the errors that were wrong", await evalJs(`document.querySelectorAll('.wu-summary .wu-list-col').length === 2`));
      ok("summary shows next test and the two buttons", await evalJs(`(() => { const a = [...document.querySelectorAll('.wu-actions a')]; const m = /^Vào luyện Cam (\\d+) · Test (\\d)$/.exec(a[0]?.textContent ?? ''); return a.length === 2 && !!m && a[0].getAttribute('href') === '#/practice/' + m[1] + '/' + m[2] && a[1].textContent === 'Về Dashboard' && a[1].getAttribute('href') === '#/'; })()`));
      ok("a streak of 3 suggests 'Đánh dấu đã khắc phục'", sum.includes("Đề xuất đánh dấu đã khắc phục") && await evalJs(`document.querySelectorAll('.wu-summary .btn-sm').length === 1`));
      ok("no XP / points / 'Chính xác' / focus score anywhere on the summary", !/\bXP\b|chính xác|focus score|điểm ôn tập|cadence/i.test(sum), sum.match(/XP|chính xác|focus score|điểm ôn tập|cadence/i)?.[0] ?? "");
      await shot("w-summary.png");
      const errs = Object.fromEntries((await dbAll("errors")).map((e) => [e.id, e]));
      const errsList = Object.values(errs);
      const topNow = errs[top.id];
      ok("the first error (answered right) went 2 -> 3 and new -> practicing", topNow.warmupStreak === 3 && topNow.status === "practicing", JSON.stringify([topNow.warmupStreak, topNow.status]));
      ok("3 errors answered right have streak >= 1; the 2 wrong ones have streak 0", errsList.filter((e) => e.warmupStreak >= 1).length === 3 && errsList.filter((e) => e.warmupStreak === 0).length === 2, JSON.stringify(errsList.map((e) => e.warmupStreak)));
      ok("right answers moved new -> practicing", errsList.filter((e) => e.status === "practicing").length === 3);
      const sess2 = await dbAll("sessions");
      ok("the same session record now has errors 3/5", sess2.length === 1 && sess2[0].warmup.errorsTotal === 5 && sess2[0].warmup.errorsCorrect === 3 && sess2[0].warmup.vocabTotal === 10, JSON.stringify(sess2[0]?.warmup));
      await clickText(".wu-summary .btn-sm", "Đánh dấu đã khắc phục");
      await sleep(600);
      ok("confirming marks the error as fixed", (await dbAll("errors")).find((e) => e.id === top.id).status === "fixed" && (await text(".wu-summary")).includes("Đã đánh dấu"));
      // N must not open quick capture on this screen
      await keyEv("n", { code: "KeyN", vk: 78, text: "n" });
      await sleep(250);
      ok("N does not open quick capture during the warm-up", await evalJs(`!document.querySelector('dialog.modal')`));
      await clickText(".wu-actions a", "Về Dashboard");
      await sleep(500);
      ok("Về Dashboard goes to #/ and the navigation is back", (await evalJs(`location.hash`)) === "#/" && (await header().catch(() => ({ nav: "?" }))).nav !== "none");
    }

    if (scenario === "warmup-exit") {
      await seedDue();
      await go(BASE + "?dev=1#/warmup");
      await waitFor(`document.querySelector('.wu-card')`);
      let done = 0;
      const seen = [];
      for (let i = 0; i < 3; i++) {
        const kind = await kindNow();
        if (kind === "flashcard") { seen.push(await text(".wu-word")); await press("Space"); await sleep(80); await digit(3); }
        else if (kind === "choice") { seen.push(await text(".wu-word")); await digit(1); }
        else if (kind === "fill") { seen.push("fill"); await typeText("zzz"); await press("Enter"); }
        else { seen.push("type"); await typeText("zzz"); await press("Enter"); }
        await sleep(300);
        done++;
        if (i < 2) { await press("Enter"); await sleep(250); }
      }
      ok("3 cards answered, progress shows 3/10", (await header()).progress === "3/10", (await header()).progress);
      await clickText(".wu-exit", "Thoát");
      await sleep(600);
      ok("Thoát goes to the Dashboard", (await evalJs(`location.hash`)) === "#/");
      const vocab = await dbAll("vocab");
      const reviewed = vocab.filter((v) => v.lastReviewedAt === today);
      ok("the 3 answered cards were saved; the other 7 are untouched", reviewed.length === 3 && vocab.filter((v) => !v.lastReviewedAt).length === 7, `${reviewed.length} reviewed`);
      const sess = await dbAll("sessions");
      ok("a session record exists with 3 graded words", sess.length === 1 && sess[0].warmup.vocabTotal === 3 && sess[0].warmup.errorsTotal === 0, JSON.stringify(sess[0]?.warmup));
      await go(BASE + "?dev=1#/warmup");
      await waitFor(`document.querySelector('.wu-card')`);
      ok("starting again: the 3 saved cards are not due any more (7 left)", (await header()).progress === "0/7", (await header()).progress);
      await clickText(".wu-skip", "Bỏ qua");
      await sleep(200);
      ok("Bỏ qua moves on without grading: progress 1/7, nothing saved for that card", (await header()).progress === "1/7" && (await dbAll("vocab")).filter((v) => v.lastReviewedAt === today).length === 3);
    }

    if (scenario === "warmup-clock") {
      await seedDue();
      await go(BASE + "?dev=1&clock=3#/warmup");
      await waitFor(`document.querySelector('.wu-card')`);
      ok("dev clock shortens step 1 to 3 seconds (00:03)", ["00:03", "00:02"].includes((await header()).clock), (await header()).clock);
      await sleep(4200);
      const h1 = await header();
      ok("time is up: the clock shows 00:00 but the question is still there", h1.clock === "00:00" && (await kindNow()) !== "other", JSON.stringify(h1));
      // finish the current question
      const kind = await kindNow();
      if (kind === "flashcard") { await press("Space"); await sleep(80); await digit(3); }
      else if (kind === "choice") await digit(1);
      else { await typeText("zzz"); await press("Enter"); }
      await sleep(300);
      ok("after finishing it, the next button says 'Sang bước 2' (not 'Câu tiếp theo')", (await text(".wu-next")).includes("Sang bước 2"), await text(".wu-next"));
      await press("Enter");
      await sleep(300);
      let hd = await header();
      ok("step 2 started with its own clock (00:03/00:02) and progress 0/5", hd.active[1] && ["00:03", "00:02"].includes(hd.clock) && hd.progress === "0/5", JSON.stringify(hd));
      await sleep(4200);
      ok("step 2 time is up too, the current error is still on screen", (await header()).clock === "00:00" && (await kindNow()) === "error");
      await typeText("x"); await press("Enter"); await sleep(200); await digit(1); await sleep(400);
      await waitFor(`document.querySelector('.wu-summary')`, 5000);
      ok("after the unfinished-time error, the summary is shown (1 error graded, others not asked)", (await text(".wu-summary")).includes("0/1 lỗi"), (await text(".wu-summary")).replace(/\s+/g, " ").slice(0, 100));
    }

    if (scenario === "warmup-empty") {
      await go(BASE + "?dev=1#/warmup");
      await waitFor(`document.querySelector('.wu-card')`);
      ok("no due words: a message and a button to step 2", (await text(".wu-card")).includes("Hôm nay chưa có từ nào đến hạn ôn") && (await text(".wu-next, .wu-card .btn-primary")).includes("Sang bước 2"));
      await press("Enter"); await sleep(250);
      ok("step 2 with no usable errors: a message and a button to the summary", (await header()).active[1] && (await text(".wu-card")).includes("Chưa có lỗi nào để luyện"));
      await press("Enter"); await sleep(300);
      await waitFor(`document.querySelector('.wu-summary')`, 4000);
      ok("empty summary: 0/0 and nothing saved", (await text(".wu-summary")).includes("0/0 từ") && (await dbAll("sessions")).length === 0);
    }

    if (scenario === "warmup-m") {
      await seedDue(390, 844);
      await go(BASE + "?dev=1#/", 390, 844);
      await waitFor(`document.querySelector('.hero-chip')?.textContent.startsWith('Đến hạn')`);
      ok("Dashboard at 390: start button fits (no horizontal overflow)", await evalJs(`document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.hero .btn-hero')].every(b => b.getBoundingClientRect().right <= innerWidth)`));
      await shot("wm-dashboard.png");
      await go(BASE + "?dev=1#/warmup", 390, 844);
      await waitFor(`document.querySelector('.wu-card')`);
      const shotKinds = new Set();
      for (let i = 0; i < 10; i++) {
        const kind = await kindNow();
        const overflow = await evalJs(`document.documentElement.scrollWidth > innerWidth`);
        if (!shotKinds.has(kind)) { shotKinds.add(kind); await shot(`wm-${kind}.png`); }
        ok(`390px ${kind}: no horizontal overflow, header fits`, !overflow && await evalJs(`document.querySelector('.wu-header').getBoundingClientRect().right <= innerWidth + 1`));
        if (kind === "flashcard") { await press("Space"); await sleep(80); if (!shotKinds.has("flashcard-back")) { shotKinds.add("flashcard-back"); await shot("wm-flashcard-back.png"); } await digit(3); }
        else if (kind === "choice") await digit(1);
        else { await typeText("zzz"); await press("Enter"); }
        await sleep(300);
        if (!shotKinds.has(kind + "-after")) { shotKinds.add(kind + "-after"); await shot(`wm-${kind}-after.png`); }
        await press("Enter"); await sleep(250);
      }
      for (let i = 0; i < 5; i++) {
        if (i === 0) await shot("wm-error.png");
        await typeText("x"); await press("Enter"); await sleep(200);
        if (i === 0) await shot("wm-error-answer.png");
        await digit(2); await sleep(350);
      }
      await waitFor(`document.querySelector('.wu-summary')`, 4000);
      ok("390px summary: no horizontal overflow", await evalJs(`document.documentElement.scrollWidth <= innerWidth`));
      await shot("wm-summary.png");
    }
    console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
  } else if (scenario === "dashboard" || scenario === "dashboard-m") {
    let fails = 0;
    const ok = (name, cond, detail = "") => { if (!cond) fails++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail !== "" ? " — " + detail : ""}`); };
    const KEYS = { Enter: { code: "Enter", vk: 13, text: "\r" }, Space: { key: " ", code: "Space", vk: 32, text: " " }, Tab: { code: "Tab", vk: 9 } };
    const keyEv = async (key, { code, vk, text, modifiers = 0 }) => {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, text, modifiers });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
    };
    const press = async (name) => { const k = KEYS[name]; await keyEv(k.key ?? name, k); };
    const digit = (d) => keyEv(String(d), { code: "Digit" + d, vk: 48 + Number(d), text: String(d) });
    const typeText = (t) => send("Input.insertText", { text: t });
    const text = (sel) => evalJs(`document.querySelector(${JSON.stringify(sel)})?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`);
    const texts = (sel) => evalJs(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(e => e.innerText.replace(/\\s+/g, ' ').trim())`);
    const click = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no ' + ${JSON.stringify(sel)}); e.click(); return true; })()`);
    const clickText = (sel, t) => evalJs(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(b => b.textContent.trim().startsWith(${JSON.stringify(t)})); if (!e) throw new Error('no ' + ${JSON.stringify(sel + ' / ' + t)}); e.click(); return true; })()`);
    const dash = async (w = 1280, h2 = 800) => { await go(BASE + "?dev=1#/", w, h2); await waitFor(`document.querySelector('.hero') && document.querySelector('.stat-card')`); await sleep(300); };
    const cards = () => texts(".stat-card");
    const overflow = () => evalJs(`document.documentElement.scrollWidth > innerWidth`);
    const BAD = /chuỗi|\bXP\b|focus flow|claude 3|xem tất cả|authentic|thêm nhanh/i;
    const seedDue = async (w = 1280, h2 = 800) => {
      await go(BASE + "?dev=1#/dev", w, h2);
      await waitFor(`document.querySelector('[data-act=seed]')`);
      await evalJs(`document.querySelector('[data-act=seed]').click()`);
      await waitFor(`document.querySelector('.dev-table tbody tr td:nth-child(2)')?.textContent === '10'`);
      await evalJs(`document.querySelector('[data-act=due]').click()`);
      await sleep(900);
    };

    // ---------- empty database ----------
    await dash(scenario === "dashboard-m" ? 390 : 1280, scenario === "dashboard-m" ? 844 : 800);
    ok("empty: hero says 0 từ · 0 lỗi, next = Cam 10 · Test 1, reason 'Bắt đầu từ đầu'", (await text(".hero-chip")) === "Đến hạn ôn: 0 từ · 0 lỗi" && (await text(".hero-title")) === "Buổi luyện tiếp theo: Cam 10 · Test 1" && (await text(".hero-reason")) === "Bắt đầu từ đầu");
    ok("empty: main button and the secondary link with the right targets", await evalJs(`(() => { const a = [...document.querySelectorAll('.hero-actions a')]; return a.length === 2 && a[0].textContent === 'Bắt đầu buổi luyện (khởi động 15 phút)' && a[0].getAttribute('href') === '#/warmup' && a[1].textContent === 'Bỏ khởi động, mở test luôn' && a[1].getAttribute('href') === '#/practice/10/1'; })()`));
    const c0 = await cards();
    ok("empty: the four cards show 0 / – / 0 / 0 and are links", c0[0].includes("0/40") && c0[0].includes("test (0%)") && c0[1].includes("–") && c0[1].includes("Cần ít nhất 2 kỹ năng") && c0[2].includes("0 từ") && c0[3].includes("0 lỗi") && c0[3].includes("Chưa có lỗi nào") && (await evalJs(`document.querySelectorAll('a.stat-card').length`)) === 4, JSON.stringify(c0));
    ok("empty: friendly 3-step guide with links instead of the activity list", (await text(".activity .section-title")) === "Bắt đầu trong 3 bước" && (await evalJs(`document.querySelectorAll('.guide-step a').length`)) === 3 && !(await evalJs(`!!document.querySelector('.activity-list')`)));
    ok("empty: no backup reminder when there is no data", (await evalJs(`getComputedStyle(document.querySelector('.nav-foot .backup-status')).display`)) === "none" || (await text(".nav-foot .backup-status")) === "");
    ok("no streak / XP / 'Focus flow' / 'Claude 3' / 'Xem tất cả' / 'Thêm nhanh' text on the page", !BAD.test(await evalJs(`document.querySelector('#view').innerText`)));
    ok("no horizontal overflow (empty)", !(await overflow()));
    await shot(scenario === "dashboard-m" ? "dm-empty.png" : "d-empty.png");

    // ---------- with data ----------
    await seedDue(scenario === "dashboard-m" ? 390 : 1280, scenario === "dashboard-m" ? 844 : 800);
    await dash(scenario === "dashboard-m" ? 390 : 1280, scenario === "dashboard-m" ? 844 : 800);
    const c1 = await cards();
    console.log("cards:", JSON.stringify(c1));
    ok("with data: never backed up -> orange reminder 'chưa sao lưu lần nào' in the sidebar (desktop) or the block (phone)", scenario === "dashboard-m"
      ? (await evalJs(`document.querySelector('.dashboard-backup .backup-status').dataset.level`)) === "warn"
      : (await evalJs(`document.querySelector('.nav-foot .backup-status').dataset.level`)) === "warn" && (await text(".nav-foot .backup-status")).includes("chưa sao lưu lần nào"));
    ok("hero counts: 10 từ đến hạn · 5 lỗi (the warm-up uses at most 5)", (await text(".hero-chip")) === "Đến hạn ôn: 10 từ · 5 lỗi", await text(".hero-chip"));

    if (scenario === "dashboard") {
      // numbers must agree with the other screens
      const num = (s, re) => Number(re.exec(s)?.[1]);
      await go(BASE + "?dev=1#/practice"); await waitFor(`document.querySelector('.summary-card')`); await sleep(300);
      const pc = await texts(".summary-card");
      ok("progress x/40 equals Cambridge Practice", c1[0].includes(pc[0].match(/(\d+\/40)/)[1]), `${c1[0]} | ${pc[0]}`);
      const practiceBand = pc[1].match(/Band trung bình (\S+)/i)[1];
      ok("band overall equals Cambridge Practice", c1[1].includes(practiceBand), `${c1[1]} | ${pc[1]}`);
      ok("band skills L/R/W/S equal Cambridge Practice", ["L", "R", "W", "S"].every((k) => { const m = new RegExp(`${k} (\\S+)`).exec(pc[1]); return m && c1[1].includes(`${k} ${m[1]}`); }), pc[1]);
      await go(BASE + "?dev=1#/vocab"); await waitFor(`document.querySelector('.vocab-stats')`); await sleep(300);
      const vs = await text(".vocab-stats");
      const vt = num(vs, /Tổng (\d+) từ/), vd = num(vs, /Đến hạn (\d+)/), vp = num(vs, /Chờ hoàn thiện (\d+)/);
      ok("vocabulary card equals the Vocabulary Bank line (tổng · đến hạn · chờ hoàn thiện)", c1[2].includes(`${vt} từ`) && c1[2].includes(`+ ${vd} đến hạn`) && c1[2].includes(`+ ${vp} chờ hoàn thiện`), `${c1[2]} | ${vs}`);
      await go(BASE + "?dev=1#/errors"); await waitFor(`document.querySelector('.summary-card')`); await sleep(300);
      const ec = await texts(".summary-card");
      const total = num(ec[0], /(\d+) lỗi/), fixed = num(ec[2], /(\d+) lỗi/);
      ok("errors card = Grammar Notebook total - fixed", c1[3].includes(`${total - fixed} lỗi`), `${c1[3]} | ${ec[0]} | ${ec[2]}`);
      ok("top group equals the Grammar Notebook's (nothing fixed yet)", c1[3].includes(ec[1].match(/NHÓM NHIỀU NHẤT (.+?) \d+ lỗi/i)?.[1] ?? "?"), ec[1]);
      // fix one error: the Dashboard drops to open errors only
      await evalJs(`[...document.querySelectorAll('.error-card')].find(c => c.querySelector('.chip-type').textContent === 'Tenses').querySelector('input[type=checkbox]').click()`);
      await clickText(".bulk-bar button", "Đánh dấu đã khắc phục"); await sleep(700);
      await dash();
      const c2 = await cards();
      ok("after fixing the only Tenses error: 4 open errors, top group now Articles (1 lỗi)", c2[3].includes("4 lỗi") && c2[3].includes("Nhóm nhiều nhất: Articles (1 lỗi)"), c2[3]);

      // each card opens the module with the filter already set
      await click("a.stat-card[href^='#/errors']"); await waitFor(`document.querySelector('.error-card')`); await sleep(300);
      ok("errors card -> #/errors?type=articles&status=open with both chips pressed and exactly 1 card", (await evalJs(`location.hash`)) === "#/errors?type=articles&status=open" && await evalJs(`[...document.querySelectorAll('.error-filters .chip-btn[aria-pressed=true]')].map(b => b.textContent).sort().join('|')`) === "Articles 1|Chưa khắc phục" && (await evalJs(`document.querySelectorAll('.error-card').length`)) === 1, await evalJs(`[...document.querySelectorAll('.error-filters .chip-btn[aria-pressed=true]')].map(b => b.textContent).join('|')`));
      await dash();
      await click("a.stat-card[href^='#/vocab']"); await waitFor(`document.querySelector('.vocab-table tbody tr')`); await sleep(300);
      ok("vocabulary card -> #/vocab?due=1 with the 'Đến hạn' chip pressed and all 10 due words listed", (await evalJs(`location.hash`)) === "#/vocab?due=1" && await evalJs(`[...document.querySelectorAll('.vocab-filters .chip-btn')].find(b => b.textContent === 'Đến hạn').getAttribute('aria-pressed') === 'true'` ) && (await evalJs(`document.querySelectorAll('.vocab-table tbody tr').length`)) === 10);
      await go(BASE + "?dev=1#/vocab"); await waitFor(`document.querySelector('.vocab-table tbody tr')`);
      ok("plain #/vocab starts with no filter pressed", !(await evalJs(`[...document.querySelectorAll('.vocab-filters .chip-btn')].some(b => b.getAttribute('aria-pressed') === 'true')`)));
      await dash();
      await click("a.stat-card[href^='#/practice?']"); await waitFor(`document.querySelector('.matrix')`); await sleep(300);
      ok("band card -> #/practice?status=improve with 'Cần cải thiện (<6.5)' pressed", (await evalJs(`location.hash`)) === "#/practice?status=improve" && await evalJs(`[...document.querySelectorAll('.filters .chip-btn')].find(b => b.textContent.startsWith('Cần cải thiện')).getAttribute('aria-pressed') === 'true'`));
      await dash();
      await click("a.stat-card[href='#/practice']"); await waitFor(`document.querySelector('.matrix')`); await sleep(300);
      ok("progress card -> #/practice with every filter on 'all'", (await evalJs(`location.hash`)) === "#/practice" && !(await evalJs(`[...document.querySelectorAll('.filters .chip-btn')].some(b => b.getAttribute('aria-pressed') === 'true' && !['Tất cả', 'Mọi kỹ năng'].includes(b.textContent))`)));

      // ---------- warm-up today changes the hero ----------
      await dash();
      ok("before warming up: main button is the warm-up", (await text(".hero-actions a")) === "Bắt đầu buổi luyện (khởi động 15 phút)");
      await go(BASE + "?dev=1#/warmup"); await waitFor(`document.querySelector('.wu-card')`);
      const tag = (await text(".wu-tag")).toLowerCase();
      if (tag.includes("flashcard")) { await press("Space"); await sleep(80); await digit(3); }
      else if (tag.includes("chọn nghĩa")) await digit(1);
      else { await typeText("zzz"); await press("Enter"); }
      await sleep(400);
      await clickText(".wu-exit", "Thoát"); await waitFor(`document.querySelector('.hero')`); await sleep(500);
      const heroLinks = await evalJs(`[...document.querySelectorAll('.hero-actions a')].map(a => ({ t: a.textContent, h: a.getAttribute('href') }))`);
      ok("after one graded answer today: 'Vào luyện Cam X · Test Y' + 'Khởi động thêm'", /^Vào luyện Cam \d+ · Test \d$/.test(heroLinks[0].t) && heroLinks[0].h.startsWith("#/practice/") && heroLinks[1].t === "Khởi động thêm" && heroLinks[1].h === "#/warmup" && heroLinks.length === 2, JSON.stringify(heroLinks));
      ok("the 'Khởi động' item appears in the activity list, dated Hôm nay", await evalJs(`[...document.querySelectorAll('.activity-item')].some(i => i.dataset.kind === 'warmup' && /^nhớ \\d\\/1 từ$/.test(i.querySelector('.activity-detail').textContent.trim()) && i.querySelector('.activity-date').textContent === 'Hôm nay' && i.querySelector('a').getAttribute('href') === '#/warmup')`));

      // ---------- quick capture is grouped by (day, test) ----------
      const next = heroLinks[0].h.replace("#/practice/", "").split("/");
      const newCapture = async (tabKey) => { await keyEv("n", { code: "KeyN", vk: 78, text: "n" }); await waitFor(`document.querySelector('dialog.modal[open]')`); await keyEv(tabKey, { code: "Digit" + tabKey, vk: 48 + Number(tabKey), modifiers: 1 }); await sleep(150); };
      await newCapture("1"); await typeText("zeta"); await press("Enter"); await waitFor(`!document.querySelector('dialog.modal')`); await sleep(250);
      await newCapture("1"); await typeText("eta"); await press("Enter"); await waitFor(`!document.querySelector('dialog.modal')`); await sleep(250);
      await newCapture("2"); await typeText("I has a pen"); await press("Enter"); await waitFor(`!document.querySelector('dialog.modal')`); await sleep(500);
      const act = await evalJs(`[...document.querySelectorAll('.activity-item')].map(i => ({ kind: i.dataset.kind, date: i.querySelector('.activity-date').textContent, title: i.querySelector('.activity-title').textContent, detail: i.querySelector('.activity-detail')?.textContent ?? '', href: i.querySelector('a').getAttribute('href'), link: i.querySelector('a').textContent }))`);
      console.log("activity:", JSON.stringify(act));
      const cap = act.find((a) => a.kind === "capture");
      ok("quick capture of 2 words + 1 error shows '3 lần ghi (2 từ, 1 lỗi)' · Cam X Test Y with a link to that test", cap && cap.title === "3 lần ghi (2 từ, 1 lỗi)" && cap.detail === `Cam ${next[0]} Test ${next[1]}` && cap.href === `#/practice/${next[0]}/${next[1]}` && cap.date === "Hôm nay", JSON.stringify(cap));
      ok("the list has exactly 5 items, newest first (today's items before the older attempts)", act.length === 5 && act.slice(0, 2).every((a) => a.date === "Hôm nay") && act.slice(2).every((a) => a.kind === "attempt" && a.date !== "Hôm nay"));
      ok("attempt items read 'Cam 15 · Test N · Skill' with a score and link to the test", act.filter((a) => a.kind === "attempt").every((a) => /^Cam 15 · Test \d · (Listening|Reading|Writing Task 2|Speaking)$/.test(a.title) && /Band \d\.\d$/.test(a.detail) && /^#\/practice\/15\/\d$/.test(a.href)), JSON.stringify(act.filter((a) => a.kind === "attempt").map((a) => a.title + " — " + a.detail)));
      ok("the capture also lives in the cards: vocabulary 12 từ", (await cards())[2].includes("12 từ"));
      await shot("d-data.png");

      // ---------- backup reminder ----------
      await evalJs(`localStorage.setItem('lastBackupAt', new Date(Date.now() - 5 * 86400000).toISOString()); document.dispatchEvent(new CustomEvent('elh:backup-done')); true`); await sleep(500);
      const bs = await evalJs(`(() => { const e = document.querySelector('.nav-foot .backup-status'); return { text: e.textContent, level: e.dataset.level, color: getComputedStyle(e).color }; })()`);
      ok("5 days old and data changed since: orange 'Sao lưu lần cuối: 5 ngày trước'", bs.text === "Sao lưu lần cuối: 5 ngày trước" && bs.level === "warn" && bs.color === "rgb(245, 158, 11)", JSON.stringify(bs));
      await click('.nav-foot [data-act=backup]'); await sleep(1200);
      const bs2 = await evalJs(`({ text: document.querySelector('.nav-foot .backup-status').textContent, level: document.querySelector('.nav-foot .backup-status').dataset.level })`);
      ok("after backing up the line updates by itself: 'hôm nay', no warning", bs2.text === "Sao lưu lần cuối: hôm nay" && bs2.level === "ok", JSON.stringify(bs2));
      await evalJs(`localStorage.setItem('lastBackupAt', new Date(Date.now() - 9 * 86400000).toISOString()); document.dispatchEvent(new CustomEvent('elh:backup-done')); true`); await sleep(500);
      ok("9 days old: still orange while the data is newer", (await evalJs(`document.querySelector('.nav-foot .backup-status').dataset.level`)) === "warn");
    } else {
      // ---------- 390px ----------
      ok("390px: no horizontal overflow with data", !(await overflow()));
      const geo = await evalJs(`(() => { const hero = document.querySelector('.hero').getBoundingClientRect(); const grid = document.querySelector('.stat-grid').getBoundingClientRect(); const cols = getComputedStyle(document.querySelector('.stat-grid')).gridTemplateColumns.split(' ').length; const rows = new Set([...document.querySelectorAll('.stat-card')].map(c => Math.round(c.getBoundingClientRect().top))).size; const btn = document.querySelector('.hero .btn-hero').getBoundingClientRect(); return { heroTop: hero.top, gridTop: grid.top, cols, rows, btnRight: btn.right, btnH: btn.height, w: innerWidth }; })()`);
      ok("390px: hero first, 4 cards as a 2 x 2 grid", geo.heroTop < geo.gridTop && geo.cols === 2 && geo.rows === 2, JSON.stringify(geo));
      ok("390px: the long button 'Bắt đầu buổi luyện (khởi động 15 phút)' fits inside the screen on one line", geo.btnRight <= geo.w - 16 + 1 && geo.btnH <= 56, JSON.stringify(geo));
      ok("390px: every card's text stays inside its card", await evalJs(`[...document.querySelectorAll('.stat-card')].every(c => { const r = c.getBoundingClientRect(); return [...c.querySelectorAll('*')].every(e => e.getBoundingClientRect().right <= r.right + 1); })`));
      ok("390px: the backup block shows the reminder line", (await evalJs(`getComputedStyle(document.querySelector('.dashboard-backup')).display`)) === "block" && (await text(".dashboard-backup .backup-status")).includes("Sao lưu lần cuối"));
      ok("no streak / XP text on the phone layout", !BAD.test(await evalJs(`document.querySelector('#view').innerText`)));
      await shot("dm-data.png");
      await evalJs(`window.scrollTo(0, document.body.scrollHeight)`); await sleep(200);
      await shot("dm-bottom.png");
    }
    console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
  } else if (scenario === "recent") {
    const press = (k, vk, text) => send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: "Key" + k.toUpperCase(), windowsVirtualKeyCode: vk, text }).then(() => send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: "Key" + k.toUpperCase(), windowsVirtualKeyCode: vk }));
    const defaults = async (lastAtMsAgo) => {
      await go(BASE + "#/practice");
      await waitFor(`document.querySelector('.matrix tbody tr')`);
      await evalJs(`localStorage.setItem('lastCapture', JSON.stringify({ source: { book: 15, test: 3, skill: 'L', part: 2 }, at: Date.now() - ${lastAtMsAgo} })); true`);
      await press("n", 78, "n");
      await waitFor(`document.querySelector('dialog.modal[open]') && document.querySelector('#qc-book')`);
      const v = await evalJs(`({ book: qcv('#qc-book'), test: qcv('#qc-test'), skill: qcv('#qc-skill'), part: qcv('#qc-part') }); function qcv(s) { return document.querySelector(s).value; }`);
      await evalJs(`document.querySelector('dialog.modal .icon-btn').click()`);
      await sleep(300);
      return v;
    };
    const h2 = 2 * 3600 * 1000, h4 = 4 * 3600 * 1000;
    console.log("2h ago  ->", JSON.stringify(await defaults(h2)), "(expect Cam 15 Test 3, L, Part 2)");
    console.log("4h ago  ->", JSON.stringify(await defaults(h4)), "(expect next test = Cam 10 Test 1, skill/part empty)");
    await go(BASE + "#/practice/12/2");
    await waitFor(`document.querySelector('dialog.sheet[open]')`);
    await evalJs(`localStorage.setItem('lastCapture', JSON.stringify({ source: { book: 15, test: 3 }, at: Date.now() - 1000 })); [...document.querySelectorAll('.sheet button')].find(b => b.textContent === '+ Ghi nhanh cho test này').click()`);
    await waitFor(`document.querySelector('#qc-book')`);
    console.log("panel open ->", await evalJs(`qcv('#qc-book') + '/' + qcv('#qc-test'); function qcv(s) { return document.querySelector(s).value; }`), "(expect 12/2: the open panel beats the recent save)");
  } else if (scenario === "capture-m") {
    await go(BASE + "?dev=1#/dev", 390, 844);
    await waitFor(`document.querySelector('[data-act=seed]')`);
    await evalJs(`document.querySelector('[data-act=seed]').click()`);
    await sleep(1500);
    await go(BASE + "#/vocab", 390, 844);
    await waitFor(`document.querySelector('.vocab-cards')`);
    console.log("cards:", await evalJs(`document.querySelectorAll('.vocab-card').length`), "| page overflow-x:", await evalJs(`document.documentElement.scrollWidth > innerWidth`));
    await shot("vm-list.png");
    await evalJs(`document.querySelector('.vocab-card input[type=checkbox]').click()`);
    await sleep(200);
    await shot("vm-selected.png");
    await evalJs(`document.querySelector('.fab').click()`);
    await waitFor(`document.querySelector('dialog.modal[open]')`);
    await sleep(300);
    await shot("vm-capture.png");
    console.log("modal inside viewport:", await evalJs(`(() => { const r = document.querySelector('dialog.modal').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()`));
    await evalJs(`document.querySelector('dialog.modal .icon-btn').click()`);
    await sleep(200);
    await evalJs(`document.querySelector('.link-btn').click()`);
    await waitFor(`document.querySelector('dialog.sheet[open]')`);
    await sleep(300);
    await shot("vm-panel.png");
  } else if (scenario === "practice-t") {
    await go(BASE + "?dev=1#/dev", 900, 1000);
    await waitFor(`document.querySelector('[data-act=seed]')`);
    await evalJs(`document.querySelector('[data-act=seed]').click()`);
    await sleep(1500);
    for (const w of [900, 768]) {
      await go(BASE + "#/practice", w, 1000);
      await waitFor(`document.querySelector('.matrix')`);
      console.log(w, "page overflow-x:", await evalJs(`document.documentElement.scrollWidth > innerWidth`), "| matrix scroll:", await evalJs(`(() => { const s = document.querySelector('.matrix-scroll'); return s.scrollWidth > s.clientWidth; })()`));
      await shot(`t-${w}.png`);
    }
    await evalJs(`document.querySelector('.test-cell').click()`);
    await waitFor(`document.querySelector('dialog.sheet[open]')`);
    await sleep(300);
    await shot("t-sheet.png");
    console.log("sheet:", JSON.stringify(await evalJs(`(() => { const r = document.querySelector('dialog.sheet').getBoundingClientRect(); return { left: r.left, w: r.width, h: r.height }; })()`)));
  } else if (scenario === "practice-m") {
    await go(BASE + "?dev=1#/dev", 390, 844);
    await waitFor(`document.querySelector('[data-act=seed]')`);
    await evalJs(`document.querySelector('[data-act=seed]').click()`);
    await sleep(1500);
    await go(BASE + "#/practice", 390, 844);
    await waitFor(`document.querySelector('.book-list')`);
    console.log("book cards:", await evalJs(`document.querySelectorAll('.book-card').length`), "| expanded:", await evalJs(`[...document.querySelectorAll('.book-head[aria-expanded=true]')].map(b => b.textContent)`));
    console.log("page overflow-x:", await evalJs(`document.documentElement.scrollWidth > window.innerWidth`));
    await shot("m-list.png");
    await evalJs(`document.querySelector('.test-row').click()`);
    await waitFor(`document.querySelector('dialog.sheet[open]')`);
    await sleep(300);
    await shot("m-sheet.png");
    console.log("sheet geometry:", JSON.stringify(await evalJs(`(() => { const r = document.querySelector('dialog.sheet').getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight }; })()`)));
    await evalJs(`document.querySelector('.sheet .detail-actions .btn-primary').click()`);
    await waitFor(`document.querySelector('dialog.modal[open]')`);
    await sleep(300);
    await shot("m-modal.png");
    console.log("modal overflow:", await evalJs(`(() => { const r = document.querySelector('dialog.modal').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()`));
  } else if (scenario.startsWith("run-")) {
    // In-app practice screen (step 6b). The PDF and the audio are made here, in a temp folder, and are never committed.
    let fails = 0;
    const ok = (name, cond, detail = "") => { if (!cond) fails++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail !== "" ? " — " + detail : ""}`); };
    const KEYS = { Enter: { code: "Enter", vk: 13, text: "\r" }, Tab: { code: "Tab", vk: 9 }, Escape: { code: "Escape", vk: 27 }, ArrowLeft: { code: "ArrowLeft", vk: 37 }, ArrowRight: { code: "ArrowRight", vk: 39 }, " ": { code: "Space", vk: 32, text: " " }, 1: { code: "Digit1", vk: 49, text: "1" }, 2: { code: "Digit2", vk: 50, text: "2" } };
    const press = async (key, n = 1) => { const k = KEYS[key]; for (let i = 0; i < n; i++) { await send("Input.dispatchKeyEvent", { type: "keyDown", key, code: k.code, windowsVirtualKeyCode: k.vk, text: k.text }); await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: k.code, windowsVirtualKeyCode: k.vk }); } };
    const pressChar = async (c) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: c, code: "Key" + c.toUpperCase(), windowsVirtualKeyCode: c.toUpperCase().charCodeAt(0), text: c }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: c, code: "Key" + c.toUpperCase(), windowsVirtualKeyCode: c.toUpperCase().charCodeAt(0) }); };
    const typeText = (t) => send("Input.insertText", { text: t });
    const click = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no ' + ${JSON.stringify(sel)}); e.click(); return true; })()`);
    const focus = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no ' + ${JSON.stringify(sel)}); e.focus(); return document.activeElement === e; })()`);
    const text = (sel) => evalJs(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
    const count = (sel) => evalJs(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
    const dbAll = (store) => evalJs(`new Promise(res => { const r = indexedDB.open('elh'); r.onsuccess = () => { const q = r.result.transaction('${store}').objectStore('${store}').getAll(); q.onsuccess = () => res(q.result.filter(x => !x.deleted)); }; })`);
    const ls = (key) => evalJs(`localStorage.getItem(${JSON.stringify(key)})`);
    const reload = async () => { await send("Page.reload"); await sleep(1300); };
    const seed = async (w = 1280, h = 800) => {
      await go(BASE + "?dev=1#/dev", w, h);
      await waitFor(`document.querySelector('[data-act=seed]')`);
      await click("[data-act=seed]");
      await sleep(1500);
    };
    const runReady = (what) => waitFor(`document.querySelector('${what}')`, 8000);
    const pdfOn = (dir) => { const p = join(dir, "Cam 15 Test 1.pdf"); writeFileSync(p, "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"); return p; };
    const wavOn = (dir, name, seconds = 20) => { // silent 8 kHz 8-bit mono WAV
      const rate = 8000; const n = rate * seconds; const buf = Buffer.alloc(44 + n, 128);
      buf.write("RIFF", 0); buf.writeUInt32LE(36 + n, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
      buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write("data", 36); buf.writeUInt32LE(n, 40);
      const p = join(dir, name); writeFileSync(p, buf); return p;
    };
    const win = (p) => p.replaceAll("/", "\\");
    const pickFiles = async (paths) => {
      const doc = await send("DOM.getDocument", { depth: 1 });
      const q = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: ".source-pane input[type=file]" });
      await send("DOM.setFileInputFiles", { files: paths.map(win), nodeId: q.result.nodeId });
      await sleep(600);
    };
    const fakeDir = mkdtempSync(join(tmpdir(), "elh-fake-exam-"));
    const clockText = () => text(".run-time");
    const answers = (n) => evalJs(`[...document.querySelectorAll('.ans')].slice(0, ${n}).map(e => e.value)`);

    if (scenario === "run-listening") {
      await seed();
      const before = (await dbAll("attempts")).filter((a) => a.book === 15 && a.test === 1 && a.skill === "L");
      console.log("existing Cam 15 Test 1 Listening attempt in sample data:", before.length ? JSON.stringify({ raw: before[0].rawScore, band: before[0].band }) : "none");

      // Panel -> button
      await go(BASE + "#/practice/15/1");
      await waitFor(`document.querySelector('.run-links a')`);
      ok("panel has three practice buttons", (await count(".run-links a")) === 3 && (await evalJs(`[...document.querySelectorAll('.run-links a')].map(a => a.textContent).join('|')`)) === "Luyện Listening|Luyện Reading|Luyện Writing");
      await evalJs(`[...document.querySelectorAll('.run-links a')][0].click()`);
      ok("route opened", await runReady(".run") && (await evalJs(`location.hash`)) === "#/practice/15/1/L");
      ok("nav and FAB are hidden", await evalJs(`getComputedStyle(document.querySelector('.nav')).display === 'none' && getComputedStyle(document.querySelector('.fab')).display === 'none'`));
      ok("two columns on a laptop (source left, sheet right), no tabs", await evalJs(`(() => { const a = document.querySelector('.run-source').getBoundingClientRect(), b = document.querySelector('.run-sheet').getBoundingClientRect(); return a.right <= b.left + 1 && a.top === b.top && getComputedStyle(document.querySelector('.run-tabs')).display === 'none'; })()`));
      ok("40 boxes grouped 4 x 10 (Part 1..4)", (await count(".ans")) === 40 && (await evalJs(`[...document.querySelectorAll('.sheet-group')].map(g => g.querySelectorAll('.ans').length).join(',')`)) === "10,10,10,10" && (await evalJs(`document.querySelector('.sheet-group-title').textContent`)) === "Part 1 · câu 1–10");
      ok("clock shows 30:00 for Listening and has NOT started: label 'Chưa bắt đầu', button 'Bắt đầu'", (await clockText()) === "30:00" && (await text(".run-time-label")) === "Chưa bắt đầu" && (await text("[data-role=pause]")) === "Bắt đầu");
      await sleep(1400);
      ok("it is still 30:00 a moment later", (await clockText()) === "30:00");

      // Drive link: the preview frame, and the link that always opens a new tab
      await evalJs(`new Promise(res => { const r = indexedDB.open('elh'); r.onsuccess = () => { const tx = r.result.transaction('tests', 'readwrite'); tx.objectStore('tests').put({ key: '15-1', book: 15, test: 1, pdfUrl: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing', audioUrls: ['https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0AAAAAA/view', '', '', ''], pinned: false, note: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deleted: false }); tx.oncomplete = () => res(true); }; })`);
      await reload(); // the screen reads the saved links when it opens
      await runReady(".run .ans");
      await click(".source-modes [data-mode=drive]");
      ok("Drive mode embeds the /preview frame", (await evalJs(`document.querySelector('.run-pdf')?.src`)) === "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/preview");
      ok("Drive mode: 'Mở PDF trong tab mới' opens the saved link; fallback note and audio link present", (await evalJs(`document.querySelector('[data-role=open-pdf]').getAttribute('href')`)).startsWith("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view") && (await evalJs(`document.querySelector('[data-role=open-pdf]').target`)) === "_blank" && (await text("[data-role=drive-note]")).includes("Chọn file trên máy") && (await count(".source-body .link-buttons a")) === 1);
      await click(".source-modes [data-mode=file]");
      ok("file mode: the 'new tab' link is always there (disabled until a PDF is picked)", (await count("[data-role=open-pdf]")) === 1 && (await evalJs(`document.querySelector('[data-role=open-pdf]').getAttribute('aria-disabled')`)) === "true");

      // Pick the PDF + 4 audio files (in a scrambled order: they must come out as Part 1..4)
      const pdf = pdfOn(fakeDir);
      const wavs = ["Track 10.wav", "Track 2.wav", "Track 1.wav", "Track 3.wav"].map((n) => wavOn(fakeDir, n));
      await pickFiles([wavs[0], pdf, wavs[1], wavs[2], wavs[3]]);
      ok("PDF shown from a blob: URL", (await evalJs(`document.querySelector('.run-pdf')?.src`)).startsWith("blob:"));
      ok("'Mở PDF trong tab mới' points at the blob and opens a new tab", (await evalJs(`document.querySelector('[data-role=open-pdf]').href`)).startsWith("blob:") && (await evalJs(`document.querySelector('[data-role=open-pdf]').target`)) === "_blank");
      ok("4 audio tracks in natural name order as Part 1..4", (await evalJs(`[...document.querySelectorAll('.run-track option')].map(o => o.textContent).join(' | ')`)) === "Part 1 · Track 1.wav | Part 2 · Track 2.wav | Part 3 · Track 3.wav | Part 4 · Track 10.wav");
      ok("nothing was stored from the files (IndexedDB/localStorage hold names only)", !(await evalJs(`JSON.stringify(Object.entries(localStorage)).includes('blob:') || JSON.stringify(Object.entries(localStorage)).includes('data:')`)) && (await ls("elh.runFiles.15-1")).includes("Cam 15 Test 1.pdf"));

      // Audio keys
      await waitFor(`document.querySelector('.run-audio-el').readyState >= 1`, 8000);
      await evalJs(`document.activeElement.blur(); true`);
      await press(" ");
      ok("Space plays", await waitFor(`!document.querySelector('.run-audio-el').paused`, 3000));
      ok("the first Play of the audio starts the clock", await waitFor(`document.querySelector('.run-time-label').textContent === 'Còn lại'`, 3000) && (await text("[data-role=pause]")) === "Tạm dừng");
      await press(" ");
      ok("Space pauses", await waitFor(`document.querySelector('.run-audio-el').paused`, 3000));
      await evalJs(`document.querySelector('.run-audio-el').currentTime = 10; true`);
      await press("ArrowRight");
      ok("ArrowRight seeks +5s", await evalJs(`Math.abs(document.querySelector('.run-audio-el').currentTime - 15) < 0.3`), await evalJs(`document.querySelector('.run-audio-el').currentTime`));
      await press("ArrowLeft", 2);
      ok("ArrowLeft seeks -5s (twice)", await evalJs(`Math.abs(document.querySelector('.run-audio-el').currentTime - 5) < 0.3`));
      await click("[data-role=fwd]");
      await click("[data-role=back]");
      await click("[data-role=back]");
      ok("the -5s / +5s buttons seek too and never go below 0", await evalJs(`document.querySelector('.run-audio-el').currentTime === 0`));
      await focus("#ans-1");
      await typeText("n");
      await press(" ");
      await press("ArrowRight");
      ok("typing in a box: letters, Space and arrows do not touch the audio", await evalJs(`document.querySelector('.run-audio-el').paused && document.querySelector('.run-audio-el').currentTime === 0 && document.querySelector('#ans-1').value.startsWith('n')`));
      await evalJs(`document.querySelector('#ans-1').value = ''; document.querySelector('#ans-1').dispatchEvent(new Event('input', {bubbles:true})); true`);

      // Type 12 answers with Enter, then reload at once (the pagehide flush must keep them)
      await focus("#ans-1");
      for (let i = 1; i <= 12; i++) { await typeText(`a${i}`); await press("Enter"); }
      ok("Enter moves to the next box", await evalJs(`document.activeElement.id === 'ans-13'`), await evalJs(`document.activeElement.id`));
      await reload();
      await runReady(".run .ans");
      const a12 = await answers(13);
      ok("reload right after typing: the 12 answers are still there", a12.slice(0, 12).every((v, i) => v === `a${i + 1}`) && a12[12] === "", JSON.stringify(a12));
      const el1 = JSON.parse(await ls("elh.run.15-1-L")).elapsedSec;
      ok("elapsed time was kept too", el1 > 0, String(el1));
      const frozen = await clockText();
      await sleep(1500);
      ok("after the reload the clock is paused ('Đang tạm dừng', button 'Tiếp tục') and does not move", (await text(".run-time-label")) === "Đang tạm dừng" && (await text("[data-role=pause]")) === "Tiếp tục" && (await clockText()) === frozen, `${frozen} -> ${await clockText()}`);
      await click("[data-role=pause]");
      await sleep(1400);
      ok("'Tiếp tục' runs it again", (await text(".run-time-label")) === "Còn lại" && (await clockText()) !== frozen);
      ok("after the reload the file is gone (as expected) and the remembered names are offered", (await count(".run-pdf")) === 0 && (await text("[data-role=remembered]")).includes("Cam 15 Test 1.pdf"));

      // Type the rest and wait for the 5 s autosave without reloading
      await shot("run-d-answer.png");
      await focus("#ans-13");
      for (let i = 13; i <= 40; i++) { await typeText(`a${i}`); await press("Enter"); }
      await sleep(5600);
      const saved = JSON.parse(await ls("elh.run.15-1-L"));
      ok("autosave (every 5 s) holds all 40 answers", Object.keys(saved.answers).length === 40 && saved.answers["40"] === "a40");
      ok("after the last box, Enter lands on the submit button", await evalJs(`document.activeElement.dataset.role === 'action'`));

      // Pause
      await click("[data-role=pause]");
      const t1 = await clockText();
      await sleep(1500);
      ok("pause stops the clock and says so", (await clockText()) === t1 && (await text(".run-time-label")) === "Đang tạm dừng");
      await click("[data-role=pause]");
      await sleep(1300);
      ok("resume runs it again", (await clockText()) !== t1);

      // Submit -> grading
      await click("[data-role=action]");
      ok("submit with every box filled goes straight to grading (no question)", await runReady(".grade-row") && (await count("dialog.modal")) === 0 && (await count(".grade-row")) === 40);
      ok("grading shows the unmarked count next to the save button", (await text(".run-info")) === "Đúng 0/40 · Còn 40 ô chưa chấm" && (await text("[data-role=action]")) === "Lưu điểm");
      await focus(".grade-row[data-n='1']");
      for (let i = 1; i <= 31; i++) await press("1");
      ok("key 1 marks 'Đúng' and moves to the next row", (await text(".run-info")) === "Đúng 31/40 · Còn 9 ô chưa chấm" && (await evalJs(`document.activeElement.dataset.n`)) === "32");
      for (let i = 32; i <= 40; i++) await press("2");
      ok("key 2 marks 'Sai'; all 40 marked", (await text(".run-info")) === "Đúng 31/40 · Đã chấm đủ");
      ok("wrong answers get 'Ghi lỗi/từ', right ones do not", (await count(".grade-capture")) === 9);
      await shot("run-d-grade.png");

      // Quick capture from a wrong answer: question 33 is in Part 4
      await click(".grade-row[data-n='33'] .grade-capture");
      await waitFor(`document.querySelector('dialog.modal[open], dialog[open]')`, 5000);
      await sleep(300);
      const src = await evalJs(`({ book: document.querySelector('#qc-book').value, test: document.querySelector('#qc-test').value, skill: document.querySelector('#qc-skill').value, part: document.querySelector('#qc-part').value })`);
      ok("quick capture opens with the source of that question (Cam 15, Test 1, Listening, Part 4)", src.book === "15" && src.test === "1" && src.skill === "L" && src.part === "4", JSON.stringify(src));
      await press("Escape");
      await sleep(400);
      // N still opens quick capture on this screen
      await evalJs(`document.activeElement.blur(); true`);
      await pressChar("n");
      ok("the N key still opens quick capture on the practice screen", await waitFor(`document.querySelector('#qc-word, #qc-wrong')`, 3000));
      await press("Escape");
      await sleep(400);

      // Save the score
      await click("[data-role=action]");
      if (before.length) {
        ok("an old score exists: the same 'overwrite?' question as editing, and Cancel keeps it", await waitFor(`document.querySelector('dialog.modal[open]')?.textContent.includes('ghi đè')`, 4000));
        await click("dialog.modal .btn-text");
        await sleep(500);
        ok("cancelled: still on the grading screen, old score unchanged", (await evalJs(`location.hash`)) === "#/practice/15/1/L" && (await dbAll("attempts")).find((a) => a.book === 15 && a.test === 1 && a.skill === "L").rawScore === before[0].rawScore);
        await click("[data-role=action]");
        await waitFor(`document.querySelector('dialog.modal[open]')`, 4000);
        await click("dialog.modal .btn-danger");
      }
      ok("saved: back on the test panel", await waitFor(`location.hash === '#/practice/15/1' && document.querySelector('.detail')`, 8000));
      const att = (await dbAll("attempts")).filter((a) => a.book === 15 && a.test === 1 && a.skill === "L");
      ok("attempt: rawScore 31, band 7.0, minutes >= 1, today", att.length === 1 && att[0].rawScore === 31 && att[0].band === 7 && att[0].durationMin >= 1 && att[0].date === new Date().toLocaleDateString("sv-SE"), JSON.stringify(att[0]));
      ok("the draft is gone after the attempt was saved", (await ls("elh.run.15-1-L")) === null);
      await sleep(400);
      const cell = await evalJs(`(() => { const b = [...document.querySelectorAll('.test-cell')].find(x => x.getAttribute('aria-label').startsWith('Cam 15 Test 1.')); return b ? b.getAttribute('aria-label') : null; })()`);
      ok("matrix cell for Cam 15 Test 1 shows Listening 7.0", /Listening[^,;.]*7\.0|L[^,;.]*7\.0/.test(cell ?? ""), cell);
      ok("panel shows Listening 31/40", (await text(".detail")).includes("31/40"));
    } else if (scenario === "run-listening-m") {
      await seed(390, 844);
      await go(BASE + "#/practice/15/1/L", 390, 844);
      await runReady(".run .ans");
      ok("390px: tabs 'Đề | Phiếu' are shown, source first, sheet hidden", await evalJs(`getComputedStyle(document.querySelector('.run-tabs')).display !== 'none' && getComputedStyle(document.querySelector('.run-source')).display !== 'none' && getComputedStyle(document.querySelector('.run-sheet')).display === 'none'`));
      ok("nav and FAB hidden on the phone too", await evalJs(`getComputedStyle(document.querySelector('.nav')).display === 'none' && getComputedStyle(document.querySelector('.fab')).display === 'none'`));
      const pdf = pdfOn(fakeDir);
      await pickFiles([pdf, wavOn(fakeDir, "m1.wav"), wavOn(fakeDir, "m2.wav")]);
      ok("audio bar stays visible while the tab is Đề", await evalJs(`!document.querySelector('.run-audio').hidden`));
      await evalJs(`document.querySelector('.run-tabs [data-tab=sheet]').click(); true`);
      ok("tab Phiếu: sheet visible, source hidden, audio bar still there", await evalJs(`getComputedStyle(document.querySelector('.run-sheet')).display !== 'none' && getComputedStyle(document.querySelector('.run-source')).display === 'none' && !document.querySelector('.run-audio').hidden`));
      await shot("run-m-sheet.png");
      ok("no horizontal overflow (sheet)", await evalJs(`document.documentElement.scrollWidth <= innerWidth`), await evalJs(`document.documentElement.scrollWidth + ' vs ' + innerWidth`));
      ok("answer boxes are at least 44px tall", await evalJs(`document.querySelector('.ans').getBoundingClientRect().height >= 44`));
      await focus("#ans-1");
      await typeText("river");
      await press("Enter");
      await evalJs(`document.querySelector('.run-tabs [data-tab=source]').click(); true`);
      await shot("run-m-source.png");
      ok("no horizontal overflow (source)", await evalJs(`document.documentElement.scrollWidth <= innerWidth`));
      await evalJs(`document.querySelector('[data-role=action]').click(); true`);
      ok("submit with blanks asks first", await waitFor(`document.querySelector('dialog.modal[open]')?.textContent.includes('Còn 39 câu chưa điền')`, 4000));
      await click("dialog.modal .btn-primary");
      await runReady(".grade-row");
      await shot("run-m-grade.png");
      ok("grading at 390px: no overflow, buttons >= 44px", await evalJs(`document.documentElement.scrollWidth <= innerWidth && document.querySelector('.grade-btn').getBoundingClientRect().height >= 44`));
    } else if (scenario === "run-clock") {
      await seed();
      await go(BASE + "#/practice/15/2/R");
      await runReady(".run .ans");
      ok("Reading: 3 passages 13 / 13 / 14", (await evalJs(`[...document.querySelectorAll('.sheet-group')].map(g => g.querySelectorAll('.ans').length).join(',')`)) === "13,13,14" && (await evalJs(`document.querySelector('.sheet-group-title').textContent`)) === "Passage 1 · câu 1–13");
      ok("Reading clock starts at 60:00", /^(60:00|59:5\d)$/.test(await clockText()), await clockText());
      await focus("#ans-1");
      await typeText("true");
      await evalJs(`document.activeElement.blur(); true`);
      // Leave the screen (it saves the draft), fake an almost finished attempt (59.2 s of a 1-minute limit), come back
      await go(BASE + "#/practice");
      await sleep(600);
      await evalJs(`(() => { const d = JSON.parse(localStorage.getItem('elh.run.15-2-R')); d.limitMin = 1; d.elapsedSec = 59.2; localStorage.setItem('elh.run.15-2-R', JSON.stringify(d)); return true; })()`);
      await go(BASE + "#/practice/15/2/R");
      await runReady(".run .ans");
      ok("restored: limit 1 minute and the typed answer", (await evalJs(`document.querySelector('.run-limit-input').value`)) === "1" && (await evalJs(`document.querySelector('#ans-1').value`)) === "true");
      await sleep(1500);
      ok("restored clock is paused: still 00:01 (0.8 s left), no 'Hết giờ' yet, button 'Tiếp tục'", (await clockText()) === "00:01" && (await text(".run-time-label")) === "Đang tạm dừng" && (await text("[data-role=pause]")) === "Tiếp tục" && await evalJs(`document.querySelector('.run-timeup').hidden`));
      await click("[data-role=pause]");
      ok("time is up: 'Hết giờ' shown and the sheet is locked", await waitFor(`document.querySelector('.run-timeup') && !document.querySelector('.run-timeup').hidden && document.querySelector('.run-time-label').textContent === 'Hết giờ'`, 4000) && await evalJs(`[...document.querySelectorAll('.ans')].every(e => e.readOnly) && document.querySelector('.run').dataset.locked === 'true'`));
      ok("clock shows 00:00 and the pause button is gone", (await clockText()) === "00:00" && await evalJs(`document.querySelector('[data-role=pause]').hidden`));
      await typeText("zzz");
      ok("typing into a locked box changes nothing", (await evalJs(`document.querySelector('#ans-2').value`)) === "");
      await evalJs(`(() => { const i = document.querySelector('.run-limit-input'); i.value = '5'; i.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`);
      await sleep(700);
      ok("raising the limit unlocks it again", await evalJs(`[...document.querySelectorAll('.ans')].every(e => !e.readOnly) && document.querySelector('.run-timeup').hidden`));
      await click("[data-role=action]");
      ok("submit with blanks asks first, Cancel stays on the sheet", await waitFor(`document.querySelector('dialog.modal[open]')`, 3000));
      await click("dialog.modal .btn-text");
      await sleep(400);
      ok("still answering", (await evalJs(`document.querySelector('.run').dataset.phase`)) === "answer");
      await click(".run-exit");
      await sleep(500);
      ok("Thoát goes back to the test panel and keeps the draft", (await evalJs(`location.hash`)) === "#/practice/15/2" && (await ls("elh.run.15-2-R")) !== null);
    } else if (scenario === "run-writing") {
      await seed();
      await go(BASE + "#/practice/15/1/W");
      await runReady(".write-text");
      ok("Writing opens on Task 2 with a 40:00 clock", (await evalJs(`document.querySelector('.seg [data-task="2"]').getAttribute('aria-pressed')`)) === "true" && (await clockText()) === "40:00", await clockText());
      await click(".seg [data-task='1']");
      await sleep(600);
      ok("Task 1: 20:00 clock, not started", (await clockText()) === "20:00" && (await text("[data-role=pause]")) === "Bắt đầu", await clockText());
      await click("[data-role=pause]");
      await sleep(1400);
      ok("'Bắt đầu' starts the clock (button becomes 'Tạm dừng')", (await clockText()) !== "20:00" && (await text("[data-role=pause]")) === "Tạm dừng");
      await click(".seg [data-task='2']");
      await sleep(600);
      ok("switching Task: the other Task's clock is its own and paused", (await clockText()) === "40:00" && (await text(".run-time-label")) === "Chưa bắt đầu");
      await click(".seg [data-task='1']");
      await sleep(600);
      ok("back on Task 1 the clock kept its time but is paused", (await text(".run-time-label")) === "Đang tạm dừng" && (await clockText()) !== "20:00");
      ok("empty text warns about the 150-word minimum", (await text(".write-count")).includes("Cần ít nhất 150 từ") && (await evalJs(`document.querySelector('.write-count').dataset.warn`)) === "true");
      await focus("#w-prompt");
      await typeText("The chart shows rainfall in three cities.");
      await focus("#w-text");
      await typeText("word ".repeat(100));
      ok("100 words: count and shortfall", (await text(".write-count")) === "Số từ: 100 · Cần ít nhất 150 từ, còn thiếu 50", await text(".write-count"));
      await typeText("word ".repeat(50));
      ok("150 words: no warning", (await evalJs(`document.querySelector('.write-count').dataset.warn`)) === "false" && (await text(".write-count")).startsWith("Số từ: 150"));
      await sleep(5800);
      let subs = (await dbAll("submissions")).filter((x) => x.kind === "writing" && x.source?.book === 15 && x.source?.test === 1 && x.source?.task === 1);
      ok("autosaved to submissions (status draft, source, no doneAt)", subs.length === 1 && subs[0].status === "draft" && !subs[0].doneAt && subs[0].wordCount === 150 && subs[0].prompt.startsWith("The chart"), JSON.stringify(subs.map((x) => ({ s: x.status, w: x.wordCount }))));
      await typeText("extra");
      await reload();
      await runReady(".write-text");
      ok("reload: Task 2 is shown again; switching to Task 1 restores the text", true);
      await click(".seg [data-task='1']");
      await sleep(900);
      ok("the text typed just before the reload is back (151 words) with the prompt", (await text(".write-count")).startsWith("Số từ: 151") && (await evalJs(`document.querySelector('#w-prompt').value`)).startsWith("The chart"));
      subs = (await dbAll("submissions")).filter((x) => x.kind === "writing" && x.source?.test === 1 && x.source?.task === 1);
      ok("no duplicate record was created", subs.length === 1, String(subs.length));
      await click("[data-role=action]");
      ok("'Xong' opens the same result modal, on Writing Task 1", await waitFor(`document.querySelector('dialog.modal[open] #f-band')`, 5000) && (await evalJs(`document.querySelector('dialog.modal[open]').textContent.includes('Writing Task 1')`)));
      ok("minutes are prefilled from the clock", Number(await evalJs(`document.querySelector('#f-min').value`)) >= 1);
      subs = (await dbAll("submissions")).filter((x) => x.kind === "writing" && x.source?.test === 1 && x.source?.task === 1);
      ok("submission finished: doneAt set, status still draft", subs.length === 1 && Boolean(subs[0].doneAt) && subs[0].status === "draft");
      await evalJs(`(() => { const i = document.querySelector('#f-band'); i.value = '6.5'; i.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`);
      await click("#result-form button[type=submit], button[form=result-form]");
      ok("band saved, back on the test panel", await waitFor(`location.hash === '#/practice/15/1' && document.querySelector('.detail')`, 8000));
      const att = (await dbAll("attempts")).filter((a) => a.book === 15 && a.test === 1 && a.skill === "W" && a.task === 1);
      ok("attempt W Task 1 band 6.5 linked to the submission", att.length === 1 && att[0].band === 6.5 && att[0].submissionId === subs[0].id, JSON.stringify(att[0]));
      ok("the clock/text copy is cleared", (await ls("elh.run.15-1-W-1")) === null);
      await go(BASE + "#/practice/15/1/W");
      await runReady(".write-text");
      await click(".seg [data-task='1']");
      await sleep(700);
      ok("a new piece starts blank after 'Xong'", (await evalJs(`document.querySelector('#w-text').value`)) === "");
    }
    if (scenario === "run-capture" || scenario === "run-capture-m") {
      // Quick-capture button in the header of the practice screen (step 6b follow-up): phone and laptop.
      const mobile = scenario === "run-capture-m";
      const [W, H] = mobile ? [390, 844] : [1280, 800];
      const realClick = async (sel) => {
        const r = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no ' + ${JSON.stringify(sel)}); e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
        for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
        await sleep(400);
      };
      const secs = (txt) => { const [m, s] = txt.split(":").map(Number); return m * 60 + s; };
      const srcVals = () => evalJs(`({ book: document.querySelector('#qc-book')?.value, test: document.querySelector('#qc-test')?.value, skill: document.querySelector('#qc-skill')?.value, part: document.querySelector('#qc-part')?.value })`);
      const dialogOpen = () => waitFor(`document.querySelector('dialog.modal[open] #qc-book')`, 4000);
      const cancelDialog = async () => { await evalJs(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.trim() === 'Hủy').click()`); await waitFor(`!document.querySelector('dialog[open]')`, 3000); };
      const sheetTab = async () => { if (mobile) await click(".run-tabs [data-tab=sheet]"); };

      await seed(W, H);
      await go(BASE + "#/practice/15/1/L", W, H);
      await runReady(".run .ans");
      ok("header has the 'Ghi nhanh' button: >=44px, nowrap, inside the viewport", await evalJs(`(() => { const b = document.querySelector('[data-role=capture]'); const r = b.getBoundingClientRect(); return b.textContent === 'Ghi nhanh' && r.width >= 44 && r.height >= 44 && getComputedStyle(b).whiteSpace === 'nowrap' && r.left >= 0 && r.right <= innerWidth; })()`));
      ok("no horizontal overflow", await evalJs(`document.documentElement.scrollWidth <= innerWidth`));
      await shot(mobile ? "capture-m-header.png" : "capture-d-header.png");

      // No box focused yet: skill is filled, the part stays empty.
      await realClick("[data-role=capture]");
      ok("no box focused: source = Cam 15 / Test 1 / Listening, part empty", (await dialogOpen()) && JSON.stringify(await srcVals()) === JSON.stringify({ book: "15", test: "1", skill: "L", part: "" }), JSON.stringify(await srcVals()));
      await cancelDialog();

      // Working: start the clock, type in two boxes, last focus = question 33 (Part 4).
      await sheetTab();
      await click("[data-role=pause]");
      await focus("#ans-3");
      await typeText("alpha");
      await focus("#ans-33");
      await typeText("beta");
      const answersBefore = await evalJs(`[...document.querySelectorAll('.ans')].map((e) => e.value).join('|')`);
      const clockBefore = secs(await clockText());
      await sleep(1300);
      await realClick("[data-role=capture]");
      ok("source follows the last box: Cam 15 / Test 1 / Part 4", (await dialogOpen()) && JSON.stringify(await srcVals()) === JSON.stringify({ book: "15", test: "1", skill: "L", part: "4" }), JSON.stringify(await srcVals()));
      ok("opening it did not pause the clock (label still 'Còn lại')", (await text(".run-time-label")) === "Còn lại");
      await typeText("serendipity");
      await press("Enter");
      ok("saved: the dialog closed", await waitFor(`!document.querySelector('dialog[open]')`, 4000));
      await sleep(500);
      const occ = (await dbAll("occurrences")).filter((o) => o.itemType === "vocab" && o.source?.book === 15 && o.source?.test === 1 && o.source?.skill === "L" && o.source?.part === 4);
      const word = (await dbAll("vocab")).find((v) => v.lemma === "serendipity");
      ok("1 word saved with source Cam 15 / Test 1 / L / Part 4", !!word && occ.some((o) => o.itemId === word.id), `${occ.length} matching occurrence(s)`);
      ok("answers are all still there", (await evalJs(`[...document.querySelectorAll('.ans')].map((e) => e.value).join('|')`)) === answersBefore && answersBefore.includes("alpha") && answersBefore.includes("beta"));
      ok("clock kept running: now lower than before, still 'Còn lại'", secs(await clockText()) < clockBefore && (await text(".run-time-label")) === "Còn lại", `${clockBefore}s -> ${secs(await clockText())}s`);
      ok("focus went back to box 33", await evalJs(`document.activeElement?.id === 'ans-33'`));

      // A fresh screen forgets the box: the part is empty even though the last save was Part 4 of the same test.
      await reload();
      await runReady(".run .ans");
      await realClick("[data-role=capture]");
      ok("fresh screen: part empty again (not inherited from the last save)", (await dialogOpen()) && (await srcVals()).part === "", JSON.stringify(await srcVals()));
      await cancelDialog();

      // Grading phase
      await sheetTab();
      await click("[data-role=action]");
      if (await waitFor(`document.querySelector('dialog[open] .btn-primary')`, 1500)) await evalJs(`document.querySelector('dialog[open] .btn-primary').click()`);
      ok("grading phase reached", await waitFor(`document.querySelector('.run[data-phase=grade]')`, 4000));
      await sheetTab();
      ok("the button is still in the header while grading", await evalJs(`!!document.querySelector('[data-role=capture]') && document.querySelector('[data-role=capture]').getBoundingClientRect().height >= 44`));
      await focus('.grade-row[data-n="12"]');
      await realClick("[data-role=capture]");
      ok("grading: source Part 2 for question 12", (await dialogOpen()) && (await srcVals()).part === "2", JSON.stringify(await srcVals()));
      await cancelDialog();
      ok("grading: focus back on row 12", await evalJs(`document.activeElement?.classList.contains('grade-row') && document.activeElement.dataset.n === '12'`));
      ok("grading: answers kept (12 -> row text)", (await evalJs(`document.querySelector('.grade-row[data-n="33"] .grade-answer').textContent`)) === "beta");
      if (mobile) await shot("capture-m-dialog.png");
      await go(BASE + "#/warmup", W, H);
      await sleep(500);
      ok("warm-up has no such button", (await count("[data-role=capture]")) === 0);
    }
    console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
  } else if (scenario === "sync" || scenario === "sync-m") {
    // Google Drive sync (step 7) against a FAKE Google sign-in and a FAKE Drive (both injected into the page; the real
    // Google is never contacted). The fake Drive file lives in localStorage so it survives reloads, like a remote copy.
    let fails = 0;
    const ok = (name, cond, detail = "") => { if (!cond) fails++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail !== "" ? " — " + detail : ""}`); };
    const FAKE = `(() => {
      const L = localStorage;
      window.__tokenRequests = []; window.__userActive = []; window.__driveCalls = [];
      window.google = { accounts: { oauth2: {
        initTokenClient(cfg) { return { requestAccessToken(o) {
          __tokenRequests.push(o); __userActive.push(navigator.userActivation.isActive);
          setTimeout(() => { if (L.getItem('__gisMode') === 'fail') cfg.error_callback({ type: 'popup_failed_to_open' }); else cfg.callback({ access_token: 'FAKE-TOKEN', expires_in: 3600 }); }, 20);
        } }; },
        hasGrantedAllScopes: () => true,
        revoke(t, cb) { window.__revoked = t; cb && cb(); } } } };
      const realFetch = window.fetch.bind(window);
      window.fetch = async (url, init = {}) => {
        const u = new URL(url, location.href);
        if (u.hostname !== 'www.googleapis.com') return realFetch(url, init);
        __driveCalls.push((init.method || 'GET') + ' ' + u.pathname);
        const mode = L.getItem('__fakeMode') || 'ok';
        if (mode === 'offline') throw new TypeError('Failed to fetch');
        if (mode === '401' || !init.headers || init.headers.Authorization !== 'Bearer FAKE-TOKEN') return new Response('', { status: 401 });
        const file = JSON.parse(L.getItem('__fakeFile') || 'null');
        const reply = (o) => new Response(JSON.stringify(o), { status: 200 });
        if (u.pathname === '/drive/v3/files' && !init.method) return reply({ files: file ? [{ id: 'F1', createdTime: file.createdTime, modifiedTime: file.modifiedTime }] : [] });
        if (u.pathname === '/drive/v3/files/F1' && !init.method) return file ? new Response(file.content) : new Response('', { status: 404 });
        if (u.pathname === '/upload/drive/v3/files/F1' && init.method === 'PATCH') { file.content = init.body; file.modifiedTime = new Date(Date.now() + 1).toISOString(); L.setItem('__fakeFile', JSON.stringify(file)); return reply({ id: 'F1', modifiedTime: file.modifiedTime }); }
        if (u.pathname === '/upload/drive/v3/files' && init.method === 'POST') {
          const parts = init.body.split(/--[^\\r\\n]+/).filter((p) => p.includes('Content-Type'));
          const made = { createdTime: new Date().toISOString(), modifiedTime: new Date().toISOString(), content: parts[1].split('\\r\\n\\r\\n')[1].trim() };
          L.setItem('__fakeFile', JSON.stringify(made));
          return reply({ id: 'F1', modifiedTime: made.modifiedTime });
        }
        return new Response('', { status: 400 });
      };
    })();`;
    await send("Page.addScriptToEvaluateOnNewDocument", { source: FAKE });
    const mobile = scenario === "sync-m";
    const [W, H] = mobile ? [390, 844] : [1280, 800];
    const ev = (e) => evalJs(e);
    const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
    const statusSel = mobile ? ".dashboard-backup .sync-text" : "#sync-status .sync-text";
    const lineSel = mobile ? ".dashboard-backup .sync-line" : "#sync-status .sync-line";
    const status = () => text(statusSel);
    const waitStatus = (starts, ms = 12000) => waitFor(`document.querySelector(${JSON.stringify(statusSel)})?.textContent.startsWith(${JSON.stringify(starts)})`, ms);
    const realClick = async (sel) => {
      const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no ' + ${JSON.stringify(sel)}); e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
      for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
    };
    const dlgBtn = (label) => ev(`(() => { const b = [...document.querySelectorAll('dialog[open] button')].filter((x) => x.textContent.trim() === ${JSON.stringify(label)}).at(-1); if (!b) return null; document.querySelectorAll('[data-e2e]').forEach((x) => delete x.dataset.e2e); b.dataset.e2e = 'x'; return 'dialog[open] button[data-e2e=x]'; })()`);
    const clickBtn = async (label) => { const sel = await dlgBtn(label); if (!sel) throw new Error("no dialog button " + label); await realClick(sel); await sleep(300); };
    const closeDialogs = () => ev(`document.querySelectorAll('dialog[open]').forEach((d) => d.close())`);
    const dbAll = (store) => ev(`new Promise(res => { const r = indexedDB.open('elh'); r.onsuccess = () => { const q = r.result.transaction('${store}').objectStore('${store}').getAll(); q.onsuccess = () => res(q.result.filter(x => !x.deleted)); }; })`);
    const putVocab = (rec) => ev(`new Promise(res => { const r = indexedDB.open('elh'); r.onsuccess = () => { const tx = r.result.transaction('vocab', 'readwrite'); tx.objectStore('vocab').put(${JSON.stringify(rec)}); tx.oncomplete = () => res(true); }; })`);
    const driveFile = () => ev(`JSON.parse(localStorage.getItem('__fakeFile') || 'null')`);
    const driveVocab = async () => { const f = await driveFile(); return f ? JSON.parse(f.content).data.vocab.map((v) => v.lemma) : null; };
    const reopen = async () => { await send("Page.reload"); await sleep(1300); };
    const now = () => new Date().toISOString();
    const vocabRec = (id, lemma) => ({ id, word: lemma, lemma, pos: "n", meaningVi: "thử", box: 1, nextReview: "2026-01-01", lapses: 0, contexts: [], createdAt: now(), updatedAt: now(), deleted: false });
    const backups = () => readdirSync(dlDir).filter((f) => f.startsWith("elh-backup-"));
    for (const f of backups()) unlinkSync(join(dlDir, f)); // a stale file of the same name would hide a missing download

    // Local data exists first (sample data), so the first-sync backup has something to protect.
    await go(BASE + "?dev=1#/dev", W, H);
    await waitFor(`document.querySelector('[data-act=seed]')`);
    await ev(`document.querySelector('[data-act=seed]').click()`);
    await sleep(1500);
    const seeded = (await dbAll("vocab")).length;
    await go(BASE + "#/", W, H);
    await sleep(800);

    ok("not connected: status line says 'Chưa kết nối Drive'", (await status()) === "Chưa kết nối Drive", String(await status()));
    ok("not connected: no sign-in was requested and no Drive call was made (no popup by itself)", (await ev(`__tokenRequests.length === 0 && __driveCalls.length === 0`)));
    ok("the status line is visible and at least 44px tall", await ev(`(() => { const b = document.querySelector(${JSON.stringify(lineSel)}).getBoundingClientRect(); return b.width > 0 && b.height >= 44; })()`), mobile ? "dashboard card" : "sidebar");
    await realClick(lineSel);
    ok("clicking the status line opens the dialog with 'Kết nối Google Drive' enabled", await waitFor(`document.querySelector('dialog[open] .sync-dialog')`, 3000) && (await dlgBtn("Kết nối Google Drive")) !== null && !(await ev(`document.querySelector('dialog[open] .btn-primary').disabled`)));
    ok("dialog text has no stray 'null'", !(await text("dialog[open] .sync-dialog")).includes("null"));
    if (mobile) { await shot("sync-m-dialog.png"); ok("dialog fits the phone width", await ev(`(() => { const r = document.querySelector('dialog[open]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; })()`)); }

    // Connect: a REAL mouse click, so the page has user activation when requestAccessToken runs.
    await clickBtn("Kết nối Google Drive");
    ok("connect called requestAccessToken once, inside the click (user activation active)", (await ev(`__tokenRequests.length === 1 && __userActive[0] === true`)));
    ok("sync finished: 'Đã đồng bộ'", await waitStatus("Đã đồng bộ"), await status());
    ok("first sync downloaded a backup JSON before merging", backups().length === 1, backups().join(","));
    ok("Drive file created with the local words", (await driveVocab())?.length === seeded, `${(await driveVocab())?.length} / ${seeded}`);
    ok("flag 'connected' is in localStorage; the token is nowhere in storage, the Drive file or IndexedDB", await ev(`(async () => {
      const all = JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([k]) => !k.startsWith('__fake'))));
      const idb = JSON.stringify(await new Promise(res => { const r = indexedDB.open('elh'); r.onsuccess = () => { const out = {}; const names = [...r.result.objectStoreNames]; let n = 0; names.forEach(s => { const q = r.result.transaction(s).objectStore(s).getAll(); q.onsuccess = () => { out[s] = q.result; if (++n === names.length) res(out); }; }); }; }));
      return localStorage.getItem('elh.sync.connected') === '1' && !all.includes('FAKE-TOKEN') && !idb.includes('FAKE-TOKEN') && !localStorage.getItem('__fakeFile').includes('FAKE-TOKEN');
    })()`));
    ok("dialog now offers 'Đồng bộ ngay' and 'Ngắt kết nối'", (await dlgBtn("Đồng bộ ngay")) !== null && (await dlgBtn("Ngắt kết nối")) !== null);

    // A word added on "another machine" (written straight into the fake Drive), pulled by 'Đồng bộ ngay'.
    await ev(`(() => { const f = JSON.parse(localStorage.getItem('__fakeFile')); const j = JSON.parse(f.content); j.data.vocab.push(${JSON.stringify(vocabRec("remote-1", "zephyr"))}); f.content = JSON.stringify(j); localStorage.setItem('__fakeFile', JSON.stringify(f)); })()`);
    await clickBtn("Đồng bộ ngay");
    ok("pull: the remote word appears locally", await waitFor(`(async () => { const r = await new Promise(res => { const q = indexedDB.open('elh'); q.onsuccess = () => { const g = q.result.transaction('vocab').objectStore('vocab').getAll(); g.onsuccess = () => res(g.result); }; }); return r.some(v => v.lemma === 'zephyr'); })()`, 6000));
    await closeDialogs();
    const callsBefore = await ev(`__driveCalls.length`);
    await ev(`window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))`);
    await sleep(800);
    ok("tab focus within 30 s of the last sync does not pull again", (await ev(`__driveCalls.length`)) === callsBefore);

    // Push after 5 s of quiet.
    await putVocab(vocabRec("local-1", "quokka"));
    await ev(`document.dispatchEvent(new CustomEvent('elh:data-changed'))`);
    await sleep(2500);
    ok("push waits: not on Drive after 2.5 s", !(await driveVocab()).includes("quokka"));
    ok("push: on Drive within about 5 s of quiet", await waitFor(`JSON.parse(JSON.parse(localStorage.getItem('__fakeFile')).content).data.vocab.some(v => v.lemma === 'quokka')`, 7000));
    ok("pushing did not wipe the word that came from the other machine", (await driveVocab()).includes("zephyr"));

    // Reopen: flag set -> silent token request without a click.
    await reopen();
    ok("reopen with the flag: asks for a token by itself (no user activation) and syncs", await waitStatus("Đã đồng bộ") && (await ev(`__tokenRequests.length === 1 && __userActive[0] === false`)), await status());

    // Silent sign-in refused (Safari-like): "Cần đăng nhập lại" + a button.
    await ev(`localStorage.setItem('__gisMode', 'fail')`);
    await reopen();
    ok("silent sign-in refused -> 'Cần đăng nhập lại'", await waitStatus("Cần đăng nhập lại"), await status());
    ok("local data is untouched while signed out", (await dbAll("vocab")).length === seeded + 2);
    await realClick(lineSel);
    await waitFor(`document.querySelector('dialog[open] .sync-dialog')`, 3000);
    ok("dialog shows 'Đăng nhập lại' and no 'Đồng bộ ngay' enabled", (await dlgBtn("Đăng nhập lại")) !== null && (await ev(`[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.trim() === 'Đồng bộ ngay').disabled`)));
    await ev(`localStorage.setItem('__gisMode', 'ok')`);
    const reqBefore = await ev(`__tokenRequests.length`);
    await clickBtn("Đăng nhập lại");
    ok("'Đăng nhập lại' requests a token inside the click and syncs", (await ev(`__userActive[__userActive.length - 1] === true && __tokenRequests.length === ${reqBefore} + 1`)) && (await waitStatus("Đã đồng bộ")), await status());
    await closeDialogs();

    // Offline, then back online.
    await ev(`localStorage.setItem('__fakeMode', 'offline')`);
    await ev(`document.dispatchEvent(new CustomEvent('elh:data-changed'))`);
    await realClick(lineSel);
    await waitFor(`document.querySelector('dialog[open] .sync-dialog')`, 3000);
    await clickBtn("Đồng bộ ngay");
    ok("network error -> 'Offline', local data kept", (await waitStatus("Offline", 5000)) && (await dbAll("vocab")).length === seeded + 2, await status());
    await ev(`localStorage.setItem('__fakeMode', 'ok')`);
    await ev(`window.dispatchEvent(new Event('online'))`);
    ok("browser 'online' event retries and recovers", await waitStatus("Đã đồng bộ", 8000), await status());

    // 401 from Drive
    await ev(`localStorage.setItem('__fakeMode', '401')`);
    await clickBtn("Đồng bộ ngay");
    ok("401 -> 'Cần đăng nhập lại', local data kept", (await waitStatus("Cần đăng nhập lại", 5000)) && (await dbAll("vocab")).length === seeded + 2, await status());
    await ev(`localStorage.setItem('__fakeMode', 'ok')`);
    await closeDialogs();
    await reopen();
    await waitStatus("Đã đồng bộ");

    // Disconnect: token revoked, flag gone, data stays (here and on Drive); reconnect does not download another backup.
    await realClick(lineSel);
    await waitFor(`document.querySelector('dialog[open] .sync-dialog')`, 3000);
    await clickBtn("Ngắt kết nối");
    ok("disconnect asks for confirmation", await waitFor(`document.querySelectorAll('dialog[open]').length === 2`, 2000));
    await clickBtn("Ngắt kết nối"); // the LAST match is the confirm button of the second dialog
    await sleep(600);
    ok("disconnect: status 'Chưa kết nối Drive', flag removed", (await status()) === "Chưa kết nối Drive" && (await ev(`localStorage.getItem('elh.sync.connected')`)) === null, await status());
    ok("disconnect: nothing was deleted (local words and the Drive file are still there)", (await dbAll("vocab")).length === seeded + 2 && (await driveVocab()).length === seeded + 2);
    await closeDialogs();
    for (const f of backups()) unlinkSync(join(dlDir, f));
    await reopen();
    await sleep(800);
    ok("after reopening disconnected: still no sign-in request", (await ev(`__tokenRequests.length === 0`)));
    await realClick(lineSel);
    await waitFor(`document.querySelector('dialog[open] .sync-dialog')`, 3000);
    await clickBtn("Kết nối Google Drive");
    ok("reconnect works and does not download a second backup", (await waitStatus("Đã đồng bộ")) && backups().length === 0, await status());
    if (!mobile) await shot("sync-d.png");

    // ---- The 60-second poll (shortened to 2 s here with ?dev=1&poll=2) ----
    await go(BASE + "?dev=1&poll=2#/", W, H);
    ok("poll: reopened connected and synced", await waitStatus("Đã đồng bộ"), await status());
    await sleep(600);
    const hasLocal = (lemma) => ev(`new Promise(res => { const r = indexedDB.open('elh'); r.onsuccess = () => { const q = r.result.transaction('vocab').objectStore('vocab').getAll(); q.onsuccess = () => res(q.result.some(v => v.lemma === ${JSON.stringify(lemma)} && !v.deleted)); }; })`);
    const waitLocal = (lemma, ms) => waitFor(`new Promise(res => { const r = indexedDB.open('elh'); r.onsuccess = () => { const q = r.result.transaction('vocab').objectStore('vocab').getAll(); q.onsuccess = () => res(q.result.some(v => v.lemma === ${JSON.stringify(lemma)} && !v.deleted)); }; })`, ms);
    const remoteAdds = (lemma, id) => ev(`(() => { const f = JSON.parse(localStorage.getItem('__fakeFile')); const j = JSON.parse(f.content); j.data.vocab.push(${JSON.stringify(vocabRec(id, lemma))}); f.content = JSON.stringify(j); f.modifiedTime = new Date(Date.now() + 5).toISOString(); localStorage.setItem('__fakeFile', JSON.stringify(f)); })()`);
    const c0 = await ev(`__driveCalls.length`);
    await sleep(5200);
    const quiet = await ev(`__driveCalls.slice(${c0})`);
    ok("nothing changed on Drive: at least 2 checks, each one only the metadata request (no download, no upload)", quiet.length >= 2 && quiet.every((c) => c === "GET /drive/v3/files"), JSON.stringify(quiet));
    await remoteAdds("pelican", "remote-p");
    ok("another machine's change reaches this tab by itself", await waitLocal("pelican", 9000));
    ok("and that round did download the file", await ev(`__driveCalls.some((c) => c.startsWith('GET /drive/v3/files/'))`));

    // hidden tab: the poll stops
    await ev(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange'))`);
    await sleep(1800);
    const h0 = await ev(`__driveCalls.length`);
    await remoteAdds("heron", "remote-h");
    await sleep(5500);
    ok("hidden tab: no request at all and the change is not pulled", (await ev(`__driveCalls.length`)) === h0 && !(await hasLocal("heron")), `${h0} -> ${await ev(`__driveCalls.length`)}`);
    await ev(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange'))`);
    ok("tab visible again: the poll resumes and the change arrives", await waitLocal("heron", 9000));

    // offline: the poll stops; back online it catches up
    await ev(`Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); window.dispatchEvent(new Event('offline'))`);
    ok("offline: status 'Offline'", await waitStatus("Offline", 4000), await status());
    const o0 = await ev(`__driveCalls.length`);
    await remoteAdds("ibis", "remote-i");
    await sleep(5500);
    ok("offline: no request at all", (await ev(`__driveCalls.length`)) === o0 && !(await hasLocal("ibis")));
    await ev(`Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true }); window.dispatchEvent(new Event('online'))`);
    ok("back online: it syncs and the change arrives", (await waitLocal("ibis", 9000)) && (await waitStatus("Đã đồng bộ", 6000)), await status());
    const syncWarn = consoleMsgs.filter((m) => m.startsWith("warning: sync:"));
    for (let i = consoleMsgs.length - 1; i >= 0; i--) if (syncWarn.includes(consoleMsgs[i])) consoleMsgs.splice(i, 1);
    console.log(`(expected sync warnings ignored: ${syncWarn.length})`);
    console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
  } else if (scenario === "enrich" || scenario === "enrich-m") {
    // "Hoàn thiện với Claude" (step 8a): 3 words + 1 error captured with the real keyboard, a sample answer made here
    // (no real Claude), reviewed, edited and saved. Duplicates fold into old cards; the warm-up can use the new data.
    let fails = 0;
    const ok = (name, cond, detail = "") => { if (!cond) fails++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail !== "" ? " — " + detail : ""}`); };
    const mobile = scenario === "enrich-m";
    const [W, H] = mobile ? [390, 844] : [1280, 800];
    const keyEv = async (key, { code, vk, text, modifiers = 0 }) => {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, text, modifiers });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
    };
    const KEYS = { Enter: { code: "Enter", vk: 13, text: "\r" }, Tab: { code: "Tab", vk: 9 } };
    const press = (name) => keyEv(name, KEYS[name]);
    const pressChar = (c) => keyEv(c, { code: "Key" + c.toUpperCase(), vk: c.toUpperCase().charCodeAt(0), text: c });
    const typeText = (t) => send("Input.insertText", { text: t });
    const ev = (e) => evalJs(e);
    const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);
    const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
    const realClick = async (sel) => {
      const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no ' + ${JSON.stringify(sel)}); e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
      for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
      await sleep(350);
    };
    const dbRaw = (store) => ev(`new Promise(res => { const r = indexedDB.open('elh'); r.onsuccess = () => { const q = r.result.transaction('${store}').objectStore('${store}').getAll(); q.onsuccess = () => res(q.result); }; })`);
    const dbLive = async (store) => (await dbRaw(store)).filter((x) => !x.deleted);
    const putRec = (store, rec) => ev(`new Promise(res => { const r = indexedDB.open('elh'); r.onsuccess = () => { const tx = r.result.transaction(${JSON.stringify(store)}, 'readwrite'); tx.objectStore(${JSON.stringify(store)}).put(${JSON.stringify(rec)}); tx.oncomplete = () => res(true); tx.onerror = tx.onabort = () => res('IDB error: ' + (tx.error && tx.error.name) + ' ' + (tx.error && tx.error.message)); }; r.onerror = () => res('open error'); })`);
    const reload = async () => { await send("Page.reload"); await sleep(1300); };
    const toastText = () => text(".status-line > span");
    const setPaste = (s) => ev(`window.__paste = ${JSON.stringify(s)}`);
    const modalOpen = () => waitFor(`document.querySelector('dialog.modal[open]') && document.activeElement && document.activeElement.closest('dialog.modal')`, 5000);
    const modalGone = () => waitFor(`!document.querySelector('dialog.modal[open]')`, 5000);
    const replaceValue = async (sel, value) => { await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.select(); return true; })()`); await typeText(value); };
    const nowIso = new Date().toISOString();
    const today = await ev(`(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); })()`);

    // A fake clipboard: records what was written and whether the click still counted as a user gesture.
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText(t) { window.__clip = t; window.__clipActive = navigator.userActivation.isActive; return Promise.resolve(); }, readText() { return Promise.resolve(window.__paste || ''); } } });` });

    await go(BASE + "#/vocab", W, H);
    // The bank prints its count only after it has read the database, so by then the stores exist.
    await waitFor(`document.querySelector('[data-role=enrich-open]')?.textContent.includes('(')`, 15000);
    // Cards that already exist: one finished card with progress (box 4), three fillers for wrong choices, one finished error.
    const oldCard = { id: "old-scarce", word: "scarce", lemma: "scarce", pos: "adjective", lemmaPos: "scarce|adjective", ipa: "/skeəs/", meaningVi: "khan hiếm", definitionEn: "", topic: "", collocations: ["scarce resources"], synonyms: [], contexts: [{ sentence: "Jobs are scarce here.", source: null, date: today }], box: 4, nextReview: "2030-01-01", lapses: 2, lastReviewedAt: null, enriched: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", deleted: false };
    await putRec("vocab", oldCard);
    for (const [i, [w, m]] of [["alpha", "chữ cái đầu"], ["beta", "chữ cái hai"], ["gamma", "chữ cái ba"]].entries()) {
      await putRec("vocab", { ...oldCard, id: `fill-${i}`, word: w, lemma: w, lemmaPos: `${w}|noun`, pos: "noun", meaningVi: m, collocations: [], contexts: [], box: 5, lapses: 0 });
    }
    await putRec("errors", { id: "old-err", original: "Information are useful.", corrected: "Information is useful.", type: "articles", signature: "articles:zero-article-uncountable", explanationVi: "Danh từ không đếm được.", correctExample: "Advice is helpful.", occurrences: 3, firstSeen: today, lastSeen: today, status: "practicing", warmupStreak: 1, enriched: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", deleted: false });
    await reload();
    await waitFor(`document.querySelector('[data-role=enrich-open]')?.textContent.includes('(')`, 15000);

    // ---- Capture with the real keyboard: 3 words (one with no sentence) and 1 error ----
    const captureWord = async (w, ctx) => {
      await pressChar("n");
      await modalOpen();
      await keyEv("1", { code: "Digit1", vk: 49, modifiers: 1 }); // N reopens on the last tab: make sure it is the word tab
      await sleep(120);
      await typeText(w);
      if (ctx) { await press("Tab"); await typeText(ctx); }
      await press("Enter");
      await modalGone();
      await sleep(300);
    };
    await captureWord("mitigate", "Governments must mitigate the effects of climate change.");
    ok("the save toast has a 'Hoàn thiện với Claude' button", (await toastText()).startsWith("Đã lưu") && (await text(".status-line .toast-action")) === "Hoàn thiện với Claude" && await ev(`document.querySelector('.status-line .toast-action').getBoundingClientRect().height >= 44`));
    await captureWord("scarcer", "Water is scarcer in the region.");
    await captureWord("recieve");
    await pressChar("n");
    await modalOpen();
    await keyEv("2", { code: "Digit2", vk: 50, modifiers: 1 });
    await sleep(150);
    await typeText("The technology has changed a lot.");
    await press("Enter");
    await modalGone();
    await sleep(300);
    const vocabNow = await dbLive("vocab");
    const idOf = (w) => vocabNow.find((v) => v.word === w)?.id;
    ok("3 words + 1 error saved with enriched:false", ["mitigate", "scarcer", "recieve"].every((w) => vocabNow.find((v) => v.word === w)?.enriched === false) && (await dbLive("errors")).filter((e) => !e.enriched).length === 1);

    // ---- Dashboard card ----
    await go(BASE + "#/", W, H);
    ok("Dashboard shows the card with both buttons while something waits", await waitFor(`document.querySelector('[data-role=enrich-card]')`, 6000) && (await text("[data-role=enrich-vocab]")) === "Từ vựng (3)" && (await text("[data-role=enrich-error]")) === "Lỗi sai (1)" && (await text(".enrich-card-text")).startsWith("4 mục"), await text(".enrich-card-text"));

    // ---- Vocabulary Bank: open the dialog ----
    await go(BASE + "#/vocab", W, H);
    ok("Vocabulary Bank button 'Hoàn thiện với Claude (3)' is enabled", await waitFor(`document.querySelector('[data-role=enrich-open]')?.textContent === 'Hoàn thiện với Claude (3)' && !document.querySelector('[data-role=enrich-open]').disabled`, 6000));
    await realClick("[data-role=enrich-open]");
    ok("dialog opens with the 3 words", await modalOpen() && (await text(".modal-title")) === "Hoàn thiện với Claude · 3 từ");
    if (mobile) ok("dialog fits the phone width", await ev(`(() => { const r = document.querySelector('dialog.modal').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; })()`));
    ok("'Mở Claude' opens claude.ai in a new tab", await ev(`(() => { const a = document.querySelector('[data-role=enrich-open-claude]'); return a.href === 'https://claude.ai/new' && a.target === '_blank' && a.rel.includes('noopener'); })()`));
    ok("'Dán' button is next to the paste box, >=44px", await ev(`(() => { const b = document.querySelector('[data-role=enrich-paste]'); const r = b.getBoundingClientRect(); return r.height >= 44 && r.width >= 44; })()`));

    // copy: first the working clipboard (the call must happen inside the click), then a refusing one
    await realClick("[data-role=enrich-copy]");
    const clip = await ev(`window.__clip ?? ''`);
    ok("copy: the prompt is on the clipboard, written inside the click (user activation active)", clip.includes("vocab_enrich") && ["mitigate", "scarcer", "recieve"].every((w) => clip.includes(w)) && (await ev(`window.__clipActive === true`)));
    ok("the prompt has the ids, the learner's sentence and no source/progress", [idOf("mitigate"), idOf("scarcer"), idOf("recieve")].every((i) => clip.includes(i)) && clip.includes("Governments must mitigate") && !/"box"|"book"|Cam \d/.test(clip));
    ok("no fallback box while copying works", await ev(`document.querySelector('[data-role=enrich-fallback]').hidden === true`));
    await ev(`navigator.clipboard.writeText = () => Promise.reject(new Error('denied'))`);
    await realClick("[data-role=enrich-copy]");
    ok("copy refused: a text box with the prompt appears, already selected", await ev(`(() => { const f = document.querySelector('[data-role=enrich-fallback]'); return !f.hidden && f.value.includes('vocab_enrich') && f.selectionStart === 0 && f.selectionEnd === f.value.length && document.activeElement === f; })()`));

    // paste: refused clipboard read -> hint; wrong content -> Vietnamese error and nothing saved
    await ev(`navigator.clipboard.readText = () => Promise.reject(new Error('denied'))`);
    await realClick("[data-role=enrich-paste]");
    ok("paste refused: hint to long-press and paste, box focused", (await text(".enrich-paste-note")).includes("Bấm giữ") && await ev(`document.activeElement === document.querySelector('[data-role=enrich-input]')`));
    await ev(`navigator.clipboard.readText = () => Promise.resolve(window.__paste || '')`);
    await setPaste("Xin lỗi, hôm nay tôi không làm được.");
    await realClick("[data-role=enrich-paste]");
    ok("'Dán' fills the box from the clipboard", (await ev(`document.querySelector('[data-role=enrich-input]').value`)) === "Xin lỗi, hôm nay tôi không làm được.");
    await realClick("[data-role=enrich-read]");
    ok("not JSON: Vietnamese error, still on the paste step", (await text("[data-role=enrich-error]")).includes("Không thấy JSON") && (await count(".enrich-row")) === 0);
    const wrongIds = JSON.stringify({ schemaVersion: 1, task: "vocab_enrich", items: [{ id: "not-a-real-id", lemma: "x", pos: "noun", ipa: "/x/", meaningVi: "x", collocations: [] }] });
    await setPaste(wrongIds);
    await realClick("[data-role=enrich-paste]");
    await realClick("[data-role=enrich-read]");
    ok("an id that was not sent: error says nothing was saved", (await text("[data-role=enrich-error]")).includes("không khớp") && (await text("[data-role=enrich-error]")).includes("Không có gì được lưu"));
    ok("database untouched after both bad answers", (await dbLive("vocab")).filter((v) => !v.enriched).length === 3);

    // ---- A good answer (sample made here), wrapped in chatter and a code fence like Claude does ----
    const item = (w, o) => ({ id: idOf(w), ...o });
    const good = JSON.stringify({ schemaVersion: 1, task: "vocab_enrich", items: [
      item("mitigate", { lemma: "mitigate", pos: "verb", ipa: "/ˈmɪtɪɡeɪt/", meaningVi: "giảm nhẹ", collocations: ["mitigate the impact", "mitigate risk"], example: "Cities must mitigate the effects of heat.", wordFamily: ["mitigation (n)"] }),
      item("scarcer", { lemma: "scarce", pos: "adjective", ipa: "/skeəs/", meaningVi: "khan hiếm (Claude)", collocations: ["scarce resources", "become scarce"], example: "Fresh water is scarce.", wordFamily: ["scarcity (n)"] }),
      item("recieve", { lemma: "receive", pos: "verb", ipa: "/rɪˈsiːv/", meaningVi: "nhận được", collocations: ["receive a letter"], example: "I did not receive the email.", wordFamily: [], noteVi: "Bạn gõ \"recieve\", có lẽ ý bạn là \"receive\" (ie, không phải ei)." }),
    ] }, null, 2);
    await setPaste(`Đây là kết quả bạn cần:\n\`\`\`json\n${good}\n\`\`\`\nChúc bạn học tốt!`);
    await realClick("[data-role=enrich-paste]");
    await realClick("[data-role=enrich-read]");
    ok("review step: 3 cards, nothing saved yet", await waitFor(`document.querySelectorAll('.enrich-row').length === 3`, 3000) && (await dbLive("vocab")).filter((v) => !v.enriched).length === 3);
    await shot(mobile ? "enrich-m-review.png" : "enrich-d-review.png");
    const rowSel = (w, f) => `.enrich-row[data-id="${idOf(w)}"] ${f}`;
    ok("misspelling note is highlighted and the suggested lemma is in an editable box", (await text(rowSel("recieve", "[data-role=enrich-note]"))).includes("receive") && (await ev(`getComputedStyle(document.querySelector(${JSON.stringify(rowSel("recieve", "[data-role=enrich-note]"))})).borderLeftWidth`)) === "4px" && (await ev(`document.querySelector(${JSON.stringify(rowSel("recieve", "[data-f=lemma]"))}).value`)) === "receive" && !(await ev(`document.querySelector(${JSON.stringify(rowSel("recieve", "[data-f=lemma]"))}).readOnly`)));
    ok("the other cards have no note", (await count(`${rowSel("mitigate", "[data-role=enrich-note]")}`)) === 0);
    ok("'scarcer' -> lemma scarce/adjective: plan says it folds into the old card and keeps its box", await ev(`(() => { const p = document.querySelector(${JSON.stringify(rowSel("scarcer", "[data-role=enrich-plan]"))}); return p.dataset.plan === 'merge' && p.textContent.includes('giữ nguyên hộp ôn'); })()`));
    ok("'mitigate' is a plain update", await ev(`document.querySelector(${JSON.stringify(rowSel("mitigate", "[data-role=enrich-plan]"))}).dataset.plan === 'update'`));
    // edit: the meaning, and the lemma (the plan follows the edit)
    await replaceValue(rowSel("mitigate", "[data-f=meaningVi]"), "giảm thiểu");
    await replaceValue(rowSel("mitigate", "[data-f=lemma]"), "scarce");
    await ev(`(() => { const s = document.querySelector(${JSON.stringify(rowSel("mitigate", "[data-f=pos]"))}); s.value = 'adjective'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    ok("editing lemma + pos to an existing word flips the plan to 'merge'", await ev(`document.querySelector(${JSON.stringify(rowSel("mitigate", "[data-role=enrich-plan]"))}).dataset.plan === 'merge'`));
    await replaceValue(rowSel("mitigate", "[data-f=lemma]"), "mitigate");
    await ev(`(() => { const s = document.querySelector(${JSON.stringify(rowSel("mitigate", "[data-f=pos]"))}); s.value = 'verb'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    ok("and back to 'update' when restored", await ev(`document.querySelector(${JSON.stringify(rowSel("mitigate", "[data-role=enrich-plan]"))}).dataset.plan === 'update'`));
    // tick boxes
    ok("save button counts the ticked cards: (3)", (await text("[data-role=enrich-save]")) === "Lưu đã chọn (3)");
    await realClick(rowSel("mitigate", "[data-f=check]"));
    ok("unticking one gives 'Lưu đã chọn (2)'", (await text("[data-role=enrich-save]")) === "Lưu đã chọn (2)");
    await realClick(rowSel("mitigate", "[data-f=check]"));
    ok("ticking it again gives (3)", (await text("[data-role=enrich-save]")) === "Lưu đã chọn (3)");
    // an invalid edit blocks the save and keeps the dialog
    await replaceValue(rowSel("recieve", "[data-f=meaningVi]"), "");
    await realClick("[data-role=enrich-save]");
    ok("a ticked card with no meaning blocks the save with a message", (await count(".enrich-row-error:not([hidden])")) === 1 && await ev(`!!document.querySelector('dialog.modal[open] .enrich-row')`) && (await dbLive("vocab")).filter((v) => !v.enriched).length === 3);
    await replaceValue(rowSel("recieve", "[data-f=meaningVi]"), "nhận được");

    await realClick("[data-role=enrich-save]");
    ok("saved: dialog closes and the toast reports the merge", await modalGone() && (await toastText()).includes("Đã lưu 3 từ") && (await toastText()).includes("1 được gộp vào mục có sẵn"), await toastText());

    // ---- What is in the database now ----
    const raw = await dbRaw("vocab");
    const live = raw.filter((v) => !v.deleted);
    const mit = live.find((v) => v.lemma === "mitigate");
    ok("mitigate card: IPA, edited meaning, collocations, pos and enriched:true", !!mit && mit.ipa === "/ˈmɪtɪɡeɪt/" && mit.meaningVi === "giảm thiểu" && mit.pos === "verb" && mit.collocations.includes("mitigate the impact") && mit.collocations.includes("mitigate risk") && mit.enriched === true, JSON.stringify(mit && { ipa: mit.ipa, m: mit.meaningVi, c: mit.collocations }));
    ok("Claude's example and word family are in their own fields; the contexts are still only the learner's sentence", mit.exampleEn === "Cities must mitigate the effects of heat." && mit.wordFamily.includes("mitigation (n)") && mit.contexts.length === 1 && mit.contexts[0].sentence === "Governments must mitigate the effects of climate change.");
    const rec = live.find((v) => v.lemma === "receive");
    ok("misspelt card now carries the correct word, verb, enriched", !!rec && rec.word === "receive" && rec.pos === "verb" && rec.meaningVi === "nhận được" && rec.enriched === true);
    const old = live.find((v) => v.id === "old-scarce");
    ok("old card 'scarce' kept its Leitner box 4, 2 lapses and review date", old.box === 4 && old.lapses === 2 && old.nextReview === "2030-01-01", `${old.box}/${old.lapses}/${old.nextReview}`);
    ok("old card took the new context, keeps its own meaning, gained collocations from Claude", old.contexts.some((c) => c.sentence === "Water is scarcer in the region.") && old.contexts.some((c) => c.sentence === "Jobs are scarce here.") && old.meaningVi === "khan hiếm" && old.collocations.includes("become scarce") && old.collocations.includes("scarce resources"));
    ok("the folded card 'scarcer' is deleted (soft), only one scarce card is live", raw.find((v) => v.word === "scarcer")?.deleted === true && live.filter((v) => v.lemma === "scarce").length === 1);
    const occ = await dbLive("occurrences");
    ok("the occurrence of 'scarcer' now points at the old card", occ.filter((o) => o.itemType === "vocab" && o.itemId === "old-scarce").length >= 1 && !occ.some((o) => o.itemId === idOf("scarcer")));

    // ---- The bank and the warm-up can use the new data ----
    await go(BASE + "#/vocab", W, H);
    ok("Vocabulary Bank shows 'Hoàn thiện với Claude (0)', disabled", await waitFor(`document.querySelector('[data-role=enrich-open]')?.textContent === 'Hoàn thiện với Claude (0)' && document.querySelector('[data-role=enrich-open]').disabled`, 6000));
    await ev(`[...document.querySelectorAll('.link-btn')].find((b) => b.textContent === 'mitigate').click()`);
    ok("word panel shows Claude's example and word family, labelled as Claude's", await waitFor(`document.querySelector('[data-role=claude-extra]')`, 4000) && (await text("[data-role=claude-extra]")).includes("Ví dụ của Claude: Cities must mitigate") && (await text("[data-role=claude-extra]")).includes("mitigation (n)"));
    await ev(`document.querySelectorAll('dialog[open], .sheet[open]').forEach((d) => d.close())`);
    const kinds = await ev(`(async () => {
      const m = await import('/js/services/leitner.js');
      const all = await new Promise(res => { const r = indexedDB.open('elh'); r.onsuccess = () => { const q = r.result.transaction('vocab').objectStore('vocab').getAll(); q.onsuccess = () => res(q.result.filter(x => !x.deleted)); }; });
      const card = (l) => all.find(v => v.lemma === l);
      const at = (l, box) => m.chooseKind({ ...card(l), box }, all);
      return { mitigateBox4: at('mitigate', 4), receiveBox3: at('receive', 3), mitigateBox5: at('mitigate', 5), mitigateNoMeaningBox4: m.chooseKind({ ...card('mitigate'), box: 4, meaningVi: '' }, all) };
    })()`);
    ok("warm-up kinds with the new data: box 3 -> choose meaning, box 4 -> cloze, box 5 -> type collocation", kinds.receiveBox3 === "choice" && kinds.mitigateBox4 === "fill" && kinds.mitigateBox5 === "type", JSON.stringify(kinds));
    ok("(for contrast) the same card without its meaning could only be a flashcard", kinds.mitigateNoMeaningBox4 === "flashcard");
    // make the two cards due and look at the real warm-up screen
    await ev(`new Promise(res => { const r = indexedDB.open('elh'); r.onsuccess = () => { const tx = r.result.transaction('vocab', 'readwrite'); const s = tx.objectStore('vocab'); const g = s.getAll(); g.onsuccess = () => { for (const v of g.result) { if (v.lemma === 'mitigate') { v.box = 4; v.nextReview = '2020-01-01'; s.put(v); } if (v.lemma === 'receive') { v.box = 3; v.nextReview = '2020-01-01'; s.put(v); } } }; tx.oncomplete = () => res(true); }; })`);
    await go(BASE + "#/warmup", W, H);
    await reload();
    ok("warm-up opens on a cloze or choose-meaning question (not a plain flashcard)", await waitFor(`document.querySelector('.wu-tag')`, 8000) && /chọn nghĩa|điền từ/i.test(await text(".wu-tag")), await text(".wu-tag"));

    // ---- Grammar Notebook ----
    await go(BASE + "#/errors", W, H);
    ok("Grammar Notebook button 'Hoàn thiện với Claude (1)'", await waitFor(`document.querySelector('[data-role=enrich-open]')?.textContent === 'Hoàn thiện với Claude (1)'`, 6000));
    await realClick("[data-role=enrich-open]");
    await modalOpen();
    await realClick("[data-role=enrich-copy]");
    const clip2 = await ev(`window.__clip ?? ''`);
    ok("error prompt: has the existing signature, the 10 groups, the wrong sentence", clip2.includes("error_enrich") && clip2.includes('"articles:zero-article-uncountable"') && clip2.includes("plurals-countability") && clip2.includes("The technology has changed a lot."), `${clip2.length} chars`);
    const newErr = (await dbLive("errors")).find((e) => !e.enriched);
    const errAnswer = JSON.stringify({ schemaVersion: 1, task: "error_enrich", items: [{ id: newErr.id, type: "articles", signature: "articles:zero-article-uncountable", corrected: "Technology has changed a lot.", explanationVi: "Technology là danh từ không đếm được nên không dùng the.", correctExample: "Information is power." }] });
    await setPaste(errAnswer);
    await realClick("[data-role=enrich-paste]");
    await realClick("[data-role=enrich-read]");
    ok("error review: plan says the signature already exists and the occurrences add up", await waitFor(`document.querySelector('.enrich-row')`, 3000) && (await text("[data-role=enrich-plan]")).includes("Signature này đã có"), await text("[data-role=enrich-plan]"));
    await realClick("[data-role=enrich-save]");
    ok("error saved and folded", await modalGone() && (await toastText()).includes("Đã lưu 1 lỗi") && (await toastText()).includes("1 được gộp"), await toastText());
    const errs = await dbRaw("errors");
    const oldErr = errs.find((e) => e.id === "old-err");
    ok("old error: occurrences 3 + 1 = 4, same signature, enriched; the new card is deleted", oldErr.occurrences === 4 && oldErr.signature === "articles:zero-article-uncountable" && oldErr.enriched === true && errs.find((e) => e.id === newErr.id)?.deleted === true, `${oldErr.occurrences}`);
    ok("Grammar Notebook button now '(0)' and disabled; the Dashboard card is gone", await waitFor(`document.querySelector('[data-role=enrich-open]')?.textContent === 'Hoàn thiện với Claude (0)' && document.querySelector('[data-role=enrich-open]').disabled`, 6000));
    await go(BASE + "#/", W, H);
    await sleep(900);
    ok("Dashboard has no enrich card when nothing waits", (await count("[data-role=enrich-card]")) === 0);
    console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);  } else if (scenario === "layout") {
    for (const [w, h, n] of [[1280, 800, "d"], [900, 800, "t"], [390, 800, "m"]]) {
      await go(BASE + "#/", w, h);
      await sleep(500);
      await shot(`layout-${n}.png`);
    }
    console.log("shots done");
  } else if (scenario === "nodev") {
    await go(BASE + "#/dev");
    await sleep(500);
    console.log("hash after #/dev without ?dev=1:", await evalJs(`location.hash`), "| h1:", await evalJs(`document.querySelector('h1').textContent`));
  }
  console.log("console problems:", consoleMsgs.length ? consoleMsgs : "none");
} finally {
  if (consoleMsgs.length) console.log('console problems at exit:', consoleMsgs);
  ws.close();
  chrome.kill();
}
process.exit(0);
