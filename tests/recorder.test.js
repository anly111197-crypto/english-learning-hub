import test from "node:test";
import assert from "node:assert/strict";
import {
  partClock, formatClock, idleHint, pickRecordingsToDelete, chooseMimeType, micErrorMessage, appendDictation,
  isAppleTouch, readAutoTranscribe, normalizeSpeechLang, MIME_CANDIDATES,
} from "../js/services/recorder.js";
import { upgradeDb } from "../js/services/db-upgrade.js";
import { DB_VERSION, LOCAL_STORES } from "../js/services/local-schema.js";
import { STORE_DEFS, STORE_NAMES, SCHEMA_VERSION } from "../js/services/schema.js";

const PLAN = { prepSec: 60, speakSec: 120 };

test("formatClock: m:ss, never negative", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(59.9), "0:59");
  assert.equal(formatClock(60), "1:00");
  assert.equal(formatClock(125), "2:05");
  assert.equal(formatClock(-4), "0:00");
  assert.equal(formatClock(3600), "60:00");
});

test("Parts 1 and 3 count up from 0:00", () => {
  for (const part of [1, 3]) {
    assert.deepEqual(partClock(part, 0, PLAN), { phase: "up", seconds: 0, label: "Đang ghi", text: "0:00" });
    assert.equal(partClock(part, 61.7, PLAN).text, "1:01");
    assert.equal(partClock(part, 600, PLAN).text, "10:00");
    assert.equal(partClock(part, 600, PLAN).phase, "up"); // never "over": there is no limit
  }
});

test("Part 2: 1 minute to prepare (counting down), then 2 minutes to speak (counting down)", () => {
  assert.deepEqual(partClock(2, 0, PLAN), { phase: "prepare", seconds: 60, label: "Chuẩn bị", text: "1:00" });
  assert.equal(partClock(2, 0.2, PLAN).text, "1:00"); // rounds up: it never shows 0:00 while time is left
  assert.equal(partClock(2, 30, PLAN).text, "0:30");
  assert.equal(partClock(2, 59.5, PLAN).text, "0:01");
  assert.deepEqual(partClock(2, 60, PLAN), { phase: "speak", seconds: 120, label: "Đang nói", text: "2:00" });
  assert.equal(partClock(2, 61, PLAN).text, "1:59");
  assert.equal(partClock(2, 150, PLAN).text, "0:30"); // 30 s of the 120 s left
  assert.equal(partClock(2, 179.5, PLAN).text, "0:01");
  assert.equal(partClock(2, 179.5, PLAN).phase, "speak");
});

test("Part 2: after 3:00 it says 'Quá giờ +m:ss' and keeps counting; it never stops by itself", () => {
  assert.deepEqual(partClock(2, 180, PLAN), { phase: "over", seconds: 0, label: "Quá giờ", text: "+0:00" });
  assert.equal(partClock(2, 187.9, PLAN).text, "+0:07");
  assert.equal(partClock(2, 245, PLAN).text, "+1:05");
  assert.equal(partClock(2, 245, PLAN).label, "Quá giờ");
});

test("Part 2 follows a shortened plan (the e2e scripts use ?dev=1&prep=2&speak=3)", () => {
  const short = { prepSec: 2, speakSec: 3 };
  assert.equal(partClock(2, 1, short).phase, "prepare");
  assert.equal(partClock(2, 2, short).phase, "speak");
  assert.equal(partClock(2, 5, short).text, "+0:00");
  assert.equal(partClock(2, 5, short).phase, "over");
});

test("partClock tolerates bad input and part given as a string", () => {
  assert.equal(partClock("2", 10, PLAN).phase, "prepare");
  assert.equal(partClock(1, -5, PLAN).text, "0:00");
  assert.equal(partClock(1, "x", PLAN).text, "0:00");
  assert.equal(partClock(7, 5, PLAN).phase, "up");
});

test("idleHint says what each Part does", () => {
  assert.equal(idleHint(2, PLAN), "Part 2: 1:00 chuẩn bị, rồi 2:00 nói");
  assert.equal(idleHint(1, PLAN), "Part 1: đồng hồ đếm lên");
  assert.equal(idleHint(3, PLAN), "Part 3: đồng hồ đếm lên");
});

// ---- the 20 newest recordings ----
const recs = (n) => Array.from({ length: n }, (_, i) => ({ id: `r${String(i).padStart(2, "0")}`, createdAt: `2026-03-01T10:${String(i).padStart(2, "0")}:00.000Z` }));

test("pickRecordingsToDelete: 20 or fewer -> nothing; the 21st pushes out the oldest", () => {
  assert.deepEqual(pickRecordingsToDelete([], 20), []);
  assert.deepEqual(pickRecordingsToDelete(recs(1), 20), []);
  assert.deepEqual(pickRecordingsToDelete(recs(20), 20), []);
  assert.deepEqual(pickRecordingsToDelete(recs(21), 20), ["r00"]);
});

test("pickRecordingsToDelete: 25 recordings -> the 5 oldest go, whatever order the list comes in", () => {
  const list = recs(25).reverse();
  assert.deepEqual(pickRecordingsToDelete(list, 20).sort(), ["r00", "r01", "r02", "r03", "r04"]);
  const shuffled = recs(25).sort((a, b) => (a.id.charCodeAt(2) * 7) % 5 - (b.id.charCodeAt(2) * 7) % 5);
  assert.deepEqual(pickRecordingsToDelete(shuffled, 20).sort(), ["r00", "r01", "r02", "r03", "r04"]);
});

test("pickRecordingsToDelete: same time -> decided by id (so the choice is always the same); default is 20; does not change the input", () => {
  const same = ["a", "b", "c"].map((id) => ({ id, createdAt: "2026-03-01T10:00:00.000Z" }));
  assert.deepEqual(pickRecordingsToDelete(same, 2), ["a"]); // newest first is c, b, a -> a is last
  const input = recs(22);
  const copy = structuredClone(input);
  assert.equal(pickRecordingsToDelete(input).length, 2);
  assert.deepEqual(input, copy);
  assert.deepEqual(pickRecordingsToDelete(recs(3), 0).sort(), ["r00", "r01", "r02"]);
});

test("recordings are counted over the whole device, not per piece", () => {
  const mixed = recs(23).map((r, i) => ({ ...r, submissionId: i % 2 ? "sub-a" : "sub-b" }));
  assert.equal(pickRecordingsToDelete(mixed, 20).length, 3);
});

// ---- microphone, format, dictation ----
test("chooseMimeType takes the first supported format; none -> '' (the browser decides)", () => {
  assert.equal(chooseMimeType((t) => t === "audio/webm;codecs=opus"), "audio/webm;codecs=opus");
  assert.equal(chooseMimeType((t) => t === "audio/mp4"), "audio/mp4"); // Safari
  assert.equal(chooseMimeType(() => false), "");
  assert.equal(chooseMimeType(() => { throw new Error("boom"); }), "");
  assert.equal(chooseMimeType((t) => t.startsWith("audio/"), MIME_CANDIDATES), MIME_CANDIDATES[0]);
});

test("micErrorMessage: a refused microphone says how to switch it back on; other causes have their own message", () => {
  const denied = micErrorMessage("NotAllowedError");
  assert.match(denied, /ổ khóa/);
  assert.match(denied, /Cho phép/);
  assert.match(denied, /Cài đặt, Safari, Micro/);
  assert.equal(micErrorMessage("PermissionDeniedError"), denied);
  assert.match(micErrorMessage("NotFoundError"), /Không tìm thấy micro/);
  assert.match(micErrorMessage("NotReadableError"), /ứng dụng khác/);
  assert.match(micErrorMessage("WhateverError"), /Không bật được micro/);
  assert.match(micErrorMessage(undefined), /Không bật được micro/);
});

test("appendDictation: typed text, then what was recognised, then the words still being recognised; single spaces", () => {
  assert.equal(appendDictation("", "hello world", ""), "hello world");
  assert.equal(appendDictation("My notes:  \n", "hello", "wor"), "My notes: hello wor");
  assert.equal(appendDictation("", "", "interim only"), "interim only");
  assert.equal(appendDictation(null, undefined, undefined), "");
  assert.equal(appendDictation("a", " b ", " c "), "a b c");
});

test("normalizeSpeechLang: en-GB or en-US, anything else is en-GB", () => {
  assert.equal(normalizeSpeechLang("en-US"), "en-US");
  assert.equal(normalizeSpeechLang("en-GB"), "en-GB");
  assert.equal(normalizeSpeechLang("vi-VN"), "en-GB");
  assert.equal(normalizeSpeechLang(null), "en-GB");
});

// ---- "Tự chuyển thành chữ" default ----
const IPHONE = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1", platform: "iPhone", maxTouchPoints: 5 };
const IPAD_OLD = { userAgent: "Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X)", platform: "iPad", maxTouchPoints: 5 };
const IPAD_AS_MAC = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 5 };
const WINDOWS = { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36", platform: "Win32", maxTouchPoints: 0 };
const MAC = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0", platform: "MacIntel", maxTouchPoints: 0 };
const ANDROID = { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130.0 Mobile", platform: "Linux armv81", maxTouchPoints: 5 };

test("auto transcribe: on by default on computers, off on iPhone and iPad (also an iPad that says it is a Mac)", () => {
  assert.equal(readAutoTranscribe(null, WINDOWS), true);
  assert.equal(readAutoTranscribe(null, MAC), true);
  assert.equal(readAutoTranscribe(null, ANDROID), true);
  assert.equal(readAutoTranscribe(null, IPHONE), false);
  assert.equal(readAutoTranscribe(null, IPAD_OLD), false);
  assert.equal(readAutoTranscribe(null, IPAD_AS_MAC), false);
  assert.equal(isAppleTouch(MAC), false);
});

test("auto transcribe: the saved choice wins on every device", () => {
  assert.equal(readAutoTranscribe("1", IPHONE), true);
  assert.equal(readAutoTranscribe("0", WINDOWS), false);
  assert.equal(readAutoTranscribe("garbage", IPHONE), false);
  assert.equal(readAutoTranscribe("garbage", WINDOWS), true);
  assert.equal(readAutoTranscribe(undefined, {}), true);
});

// ---- Recordings stay out of backups and Drive ----
test("recordings are a local-only store: not in STORE_NAMES (so not in backup, sync or exportRaw), and the backup version is unchanged", () => {
  assert.ok(!STORE_NAMES.includes("recordings"));
  assert.ok(!("recordings" in STORE_DEFS));
  assert.ok("recordings" in LOCAL_STORES);
  assert.equal(SCHEMA_VERSION, 2); // backup format: older and newer backups still read each other
  assert.equal(DB_VERSION, 3);
  assert.equal(STORE_NAMES.length, 10);
});

// ---- Upgrading the database ----
// A stand-in for IDBDatabase that writes down everything done to it.
function fakeDb(existing) {
  const calls = [];
  const names = new Set(existing);
  const indexes = new Map(existing.map((n) => [n, new Set(["old-index"])]));
  const storeFor = (name) => ({
    get indexNames() { return { contains: (ix) => indexes.get(name).has(ix) }; },
    createIndex(ix, keyPath, opts) { calls.push(["createIndex", name, ix, keyPath, opts]); indexes.get(name).add(ix); },
  });
  const db = {
    objectStoreNames: { contains: (n) => names.has(n) },
    createObjectStore(name, opts) { calls.push(["createObjectStore", name, opts]); names.add(name); indexes.set(name, new Set()); return storeFor(name); },
  };
  const tx = { objectStore(name) { calls.push(["objectStore", name]); return storeFor(name); } };
  return { db, tx, calls, names };
}
const opts = { storeDefs: STORE_DEFS, localStores: LOCAL_STORES };

test("upgrade 2 -> 3: ONLY the recordings store is created; no old store is opened, changed or re-indexed", () => {
  const { db, tx, calls, names } = fakeDb(STORE_NAMES);
  upgradeDb(db, tx, 2, opts);
  assert.deepEqual(calls.filter((c) => c[0] === "createObjectStore").map((c) => c[1]), ["recordings"]);
  assert.deepEqual(calls.filter((c) => c[0] === "createIndex").map((c) => [c[1], c[2]]), [["recordings", "submissionId"], ["recordings", "createdAt"]]);
  assert.ok(!calls.some((c) => c[0] === "objectStore")); // never touched a store that holds data
  assert.ok(![...calls].some((c) => c[0] !== "createObjectStore" && c[0] !== "createIndex" && c[0] !== "objectStore"));
  for (const n of STORE_NAMES) assert.ok(names.has(n));
  assert.ok(names.has("recordings"));
});

test("upgrade of a fresh install (0 -> 3) creates the 10 data stores with their indexes and the recordings store", () => {
  const { db, tx, calls, names } = fakeDb([]);
  upgradeDb(db, tx, 0, opts);
  assert.equal(calls.filter((c) => c[0] === "createObjectStore").length, 11);
  for (const n of [...STORE_NAMES, "recordings"]) assert.ok(names.has(n), n);
  const lemma = calls.find((c) => c[0] === "createIndex" && c[1] === "vocab" && c[2] === "lemmaPos");
  assert.equal(lemma[4].unique, true);
});

test("upgrade 1 -> 3 completes what a version 1 database lacked, as before, and adds recordings", () => {
  const { db, tx, calls } = fakeDb(["vocab"]);
  upgradeDb(db, tx, 1, opts);
  assert.ok(calls.some((c) => c[0] === "createObjectStore" && c[1] === "errors"));
  assert.ok(calls.some((c) => c[0] === "createObjectStore" && c[1] === "recordings"));
});

test("opening a version 3 database again changes nothing", () => {
  const { db, tx, calls } = fakeDb([...STORE_NAMES, "recordings"]);
  upgradeDb(db, tx, 3, opts);
  assert.deepEqual(calls, []);
});

test("a database that already has a recordings store is not asked to create it twice", () => {
  const { db, tx, calls } = fakeDb([...STORE_NAMES, "recordings"]);
  upgradeDb(db, tx, 2, opts);
  assert.deepEqual(calls, []);
});
