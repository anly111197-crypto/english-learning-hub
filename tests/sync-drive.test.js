import test from "node:test";
import assert from "node:assert/strict";
import { createDriveClient, syncOnce, SyncError, sameSnapshot, buildPayload } from "../js/services/sync-drive.js";
import { describeSync, agoText } from "../js/services/sync-status.js";
import { STORE_NAMES } from "../js/services/schema.js";

const TOKEN = "ya29.SECRET-TEST-TOKEN";

// In-memory stand-in for the Drive REST endpoints used by sync-drive.js.
function fakeDrive() {
  const drive = { files: [], calls: [], fail: null, status: null, nextId: 1 };
  drive.fetch = async (url, init = {}) => {
    drive.calls.push(`${init.method ?? "GET"} ${new URL(url).pathname}`);
    if (drive.fail) throw drive.fail;
    if (init.headers?.Authorization !== `Bearer ${TOKEN}`) return new Response("", { status: 401 });
    if (drive.status) return new Response("", { status: drive.status });
    const u = new URL(url);
    const json = (o) => new Response(JSON.stringify(o), { status: 200 });
    if (u.pathname === "/drive/v3/files" && !init.method) {
      const ordered = [...drive.files].sort((a, b) => a.createdTime.localeCompare(b.createdTime));
      return json({ files: ordered.map((f) => ({ id: f.id, createdTime: f.createdTime })) });
    }
    const m = /^\/(?:upload\/)?drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (m && !init.method) {
      const f = drive.files.find((x) => x.id === m[1]);
      return f ? new Response(f.content, { status: 200 }) : new Response("", { status: 404 });
    }
    if (m && init.method === "PATCH") {
      const f = drive.files.find((x) => x.id === m[1]);
      if (!f) return new Response("", { status: 404 });
      f.content = init.body;
      return json({ id: f.id });
    }
    if (u.pathname === "/upload/drive/v3/files" && init.method === "POST") {
      const boundary = /boundary=(.+)$/.exec(init.headers["Content-Type"])[1];
      const parts = init.body.split(`--${boundary}`).filter((p) => p.includes("Content-Type"));
      const meta = JSON.parse(parts[0].split("\r\n\r\n")[1]);
      assert.deepEqual(meta.parents, ["appDataFolder"]);
      const f = { id: `f${drive.nextId++}`, name: meta.name, createdTime: new Date(1700000000000 + drive.nextId * 1000).toISOString(), content: parts[1].split("\r\n\r\n")[1].trim() };
      drive.files.push(f);
      return json({ id: f.id });
    }
    return new Response("", { status: 400 });
  };
  drive.content = () => JSON.parse(drive.files[0].content);
  return drive;
}

const rec = (id, extra = {}) => ({ id, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...extra });
const word = (id, lemma, extra = {}) => rec(id, { word: lemma, lemma, pos: "n", ...extra });

// One "machine": an in-memory database plus the same deps the controller injects.
function device(drive, vocab = [], { token = TOKEN } = {}) {
  const d = { data: Object.fromEntries(STORE_NAMES.map((s) => [s, []])), writes: 0, beforeWrite: null };
  d.data.vocab = vocab;
  d.client = createDriveClient({ fetch: drive.fetch, getToken: async () => token });
  d.sync = (at = "2026-02-01T00:00:00.000Z") => syncOnce({
    client: d.client,
    readLocal: async () => structuredClone(d.data),
    writeLocal: async (merged, base) => {
      d.beforeWrite?.();
      if (!sameSnapshot(d.data, base)) return false;
      d.data = structuredClone(merged);
      d.writes++;
      return true;
    },
    now: () => Date.parse(at),
  });
  return d;
}

const lemmas = (d) => d.data.vocab.filter((r) => !r.deleted).map((r) => r.lemma).sort();

test("first sync creates elh-data.json in appDataFolder in the backup format", async () => {
  const drive = fakeDrive();
  const a = device(drive, [word("1", "alpha")]);
  const res = await a.sync();
  assert.deepEqual(res, { created: true, changedLocal: false, pushed: true });
  assert.equal(drive.files.length, 1);
  assert.equal(drive.files[0].name, "elh-data.json");
  const file = drive.content();
  assert.equal(file.app, "english-learning-hub");
  assert.equal(file.schemaVersion, 2);
  assert.deepEqual(file.data.vocab.map((r) => r.lemma), ["alpha"]);
  for (const s of STORE_NAMES) assert.ok(Array.isArray(file.data[s]), s);
});

test("pull, merge, push: both devices end with the union and a quiet sync pushes nothing", async () => {
  const drive = fakeDrive();
  const a = device(drive, [word("1", "alpha")]);
  const b = device(drive, [word("2", "beta")]);
  await a.sync();
  const res = await b.sync();
  assert.equal(res.changedLocal, true);
  assert.equal(res.pushed, true);
  assert.deepEqual(lemmas(b), ["alpha", "beta"]);
  await a.sync();
  assert.deepEqual(lemmas(a), ["alpha", "beta"]);
  const before = drive.calls.length;
  const quiet = await a.sync();
  assert.deepEqual(quiet, { created: false, changedLocal: false, pushed: false });
  assert.ok(!drive.calls.slice(before).some((c) => c.startsWith("PATCH")));
});

test("a soft delete spreads to the other machine", async () => {
  const drive = fakeDrive();
  const a = device(drive, [word("1", "alpha")]);
  const b = device(drive);
  await a.sync();
  await b.sync();
  assert.deepEqual(lemmas(b), ["alpha"]);
  a.data.vocab = [word("1", "alpha", { deleted: true, updatedAt: "2026-01-15T00:00:00.000Z" })];
  await a.sync("2026-01-16T00:00:00.000Z");
  await b.sync("2026-01-16T00:00:01.000Z");
  assert.deepEqual(lemmas(b), []);
  assert.equal(b.data.vocab[0].deleted, true);
});

test("two machines edit the same record: the newer updatedAt wins on both", async () => {
  const drive = fakeDrive();
  const a = device(drive, [word("1", "alpha", { meaningVi: "cũ" })]);
  const b = device(drive);
  await a.sync();
  await b.sync();
  a.data.vocab[0] = word("1", "alpha", { meaningVi: "từ máy A", updatedAt: "2026-01-10T10:00:00.000Z" });
  b.data.vocab[0] = word("1", "alpha", { meaningVi: "từ máy B", updatedAt: "2026-01-10T10:00:05.000Z" });
  await a.sync(); // A pushes first
  await b.sync(); // B is newer: wins and is pushed
  await a.sync();
  assert.equal(a.data.vocab[0].meaningVi, "từ máy B");
  assert.equal(b.data.vocab[0].meaningVi, "từ máy B");
  assert.equal(drive.content().data.vocab[0].meaningVi, "từ máy B");
});

test("the same word added on two machines under different ids becomes one record", async () => {
  const drive = fakeDrive();
  const a = device(drive, [word("a1", "alpha", { contexts: [{ sentence: "S1", source: null }] })]);
  const b = device(drive, [word("b1", "alpha", { updatedAt: "2026-01-02T00:00:00.000Z", contexts: [{ sentence: "S2", source: null }] })]);
  await a.sync();
  await b.sync();
  await a.sync();
  assert.equal(a.data.vocab.length, 1);
  assert.equal(b.data.vocab.length, 1);
  assert.deepEqual(a.data.vocab[0].contexts.map((c) => c.sentence).sort(), ["S1", "S2"]);
});

test("a network error leaves local data alone and reports network", async () => {
  const drive = fakeDrive();
  const a = device(drive, [word("1", "alpha")]);
  await a.sync();
  const b = device(drive, [word("2", "beta")]);
  drive.fail = new TypeError("Failed to fetch");
  await assert.rejects(b.sync(), (e) => e instanceof SyncError && e.code === "network");
  assert.deepEqual(lemmas(b), ["beta"]);
  assert.equal(b.writes, 0);
  assert.equal(drive.files.length, 1);
});

test("401 from Drive means sign in again, local data untouched", async () => {
  const drive = fakeDrive();
  const a = device(drive, [word("1", "alpha")]);
  await a.sync();
  const b = device(drive, [word("2", "beta")], { token: "expired-token" });
  await assert.rejects(b.sync(), (e) => e.code === "auth");
  assert.deepEqual(lemmas(b), ["beta"]);
  assert.equal(b.writes, 0);
});

test("no token at all is an auth error before any request is made", async () => {
  const drive = fakeDrive();
  const a = device(drive, [word("1", "alpha")], { token: null });
  await assert.rejects(a.sync(), (e) => e.code === "auth");
  assert.equal(drive.calls.length, 0);
});

test("other Drive errors are reported and change nothing", async () => {
  const drive = fakeDrive();
  const a = device(drive, [word("1", "alpha")]);
  drive.status = 500;
  await assert.rejects(a.sync(), (e) => e.code === "drive");
  assert.deepEqual(lemmas(a), ["alpha"]);
  assert.equal(drive.files.length, 0);
});

test("an unreadable Drive file is never overwritten and local data is kept", async () => {
  const drive = fakeDrive();
  drive.files.push({ id: "f0", name: "elh-data.json", createdTime: "2026-01-01T00:00:00.000Z", content: "{ not json" });
  const a = device(drive, [word("1", "alpha")]);
  await assert.rejects(a.sync(), (e) => e.code === "remote-invalid");
  assert.equal(drive.files[0].content, "{ not json");
  assert.deepEqual(lemmas(a), ["alpha"]);
  assert.ok(!drive.calls.some((c) => c.startsWith("PATCH") || c.startsWith("POST")));
});

test("a Drive file from a newer app version is refused, not overwritten", async () => {
  const drive = fakeDrive();
  const future = { ...buildPayload({}), schemaVersion: 99 };
  drive.files.push({ id: "f0", name: "elh-data.json", createdTime: "2026-01-01T00:00:00.000Z", content: JSON.stringify(future) });
  const a = device(drive, [word("1", "alpha")]);
  await assert.rejects(a.sync(), (e) => e.code === "remote-invalid");
  assert.equal(JSON.parse(drive.files[0].content).schemaVersion, 99);
});

test("a save made during the sync is not lost: the cycle starts over", async () => {
  const drive = fakeDrive();
  const a = device(drive, [word("1", "alpha")]);
  const b = device(drive, [word("2", "beta")]);
  await a.sync();
  let once = true;
  b.beforeWrite = () => {
    if (once) {
      once = false;
      b.data.vocab.push(word("3", "gamma", { updatedAt: "2026-02-01T00:00:00.000Z" })); // learner saves meanwhile
    }
  };
  const res = await b.sync();
  assert.equal(res.pushed, true);
  assert.deepEqual(lemmas(b), ["alpha", "beta", "gamma"]);
  assert.deepEqual(drive.content().data.vocab.map((r) => r.lemma).sort(), ["alpha", "beta", "gamma"]);
});

test("local data that keeps changing ends in a busy error without writing", async () => {
  const drive = fakeDrive();
  const a = device(drive, [word("1", "alpha")]);
  const b = device(drive, [word("2", "beta")]);
  await a.sync();
  let n = 10;
  b.beforeWrite = () => b.data.vocab.push(word(`x${n}`, `w${n++}`, { updatedAt: "2026-02-01T00:00:00.000Z" }));
  await assert.rejects(b.sync(), (e) => e.code === "busy");
  assert.equal(b.writes, 0);
});

test("a machine that lost the race self-heals on its next sync", async () => {
  const drive = fakeDrive();
  const a = device(drive, [word("1", "alpha")]);
  const b = device(drive);
  await a.sync();
  await b.sync();
  b.data.vocab.push(word("2", "beta", { updatedAt: "2026-02-02T00:00:00.000Z" }));
  await b.sync("2026-02-02T00:00:01.000Z");
  // A pushed a stale snapshot over B's push (Drive has no compare-and-set for media uploads).
  drive.files[0].content = JSON.stringify(buildPayload({ vocab: [word("1", "alpha")] }));
  const res = await b.sync("2026-02-03T00:00:00.000Z");
  assert.equal(res.pushed, true);
  assert.deepEqual(drive.content().data.vocab.map((r) => r.lemma).sort(), ["alpha", "beta"]);
});

test("with two files of the same name both machines use the oldest", async () => {
  const drive = fakeDrive();
  drive.files.push({ id: "new", name: "elh-data.json", createdTime: "2026-03-01T00:00:00.000Z", content: JSON.stringify(buildPayload({ vocab: [word("9", "zeta")] })) });
  drive.files.push({ id: "old", name: "elh-data.json", createdTime: "2026-01-01T00:00:00.000Z", content: JSON.stringify(buildPayload({ vocab: [word("1", "alpha")] })) });
  const a = device(drive);
  await a.sync();
  assert.deepEqual(lemmas(a), ["alpha"]);
});

test("the uploaded file and request bodies never contain the access token", async () => {
  const drive = fakeDrive();
  const bodies = [];
  const spy = async (url, init) => { if (init?.body) bodies.push(init.body); return drive.fetch(url, init); };
  const a = device(drive, [word("1", "alpha")]);
  a.client = createDriveClient({ fetch: spy, getToken: async () => TOKEN });
  await a.sync();
  a.data.vocab[0].updatedAt = "2026-02-05T00:00:00.000Z";
  await a.sync("2026-02-05T00:00:01.000Z");
  assert.ok(bodies.length >= 2);
  for (const b of [...bodies, drive.files[0].content]) assert.ok(!String(b).includes(TOKEN));
});

test("sameSnapshot notices a changed updatedAt or deleted flag", () => {
  const base = { vocab: [word("1", "alpha")] };
  assert.equal(sameSnapshot(base, structuredClone(base)), true);
  assert.equal(sameSnapshot(base, { vocab: [word("1", "alpha", { updatedAt: "2026-01-02T00:00:00.000Z" })] }), false);
  assert.equal(sameSnapshot(base, { vocab: [word("1", "alpha", { deleted: true })] }), false);
  assert.equal(sameSnapshot(base, { vocab: [] }), false);
});

test("describeSync gives the four sidebar states", () => {
  const now = Date.parse("2026-02-01T12:00:00.000Z");
  assert.equal(describeSync({ status: "syncing" }, now).text, "Đang đồng bộ");
  assert.equal(describeSync({ status: "offline" }, now).text, "Offline");
  assert.equal(describeSync({ status: "needs-login" }, now).text, "Cần đăng nhập lại");
  assert.equal(describeSync({ status: "synced", lastSyncAt: "2026-02-01T11:57:00.000Z" }, now).text, "Đã đồng bộ · 3 phút trước");
  assert.equal(describeSync({ status: "off" }, now).level, "off");
  assert.equal(agoText("2026-02-01T11:59:50.000Z", now), "vừa xong");
  assert.equal(agoText("2026-02-01T09:00:00.000Z", now), "3 giờ trước");
  assert.equal(agoText("2026-01-30T12:00:00.000Z", now), "2 ngày trước");
});
