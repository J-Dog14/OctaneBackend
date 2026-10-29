// Pure-logic tests for the Video Hub (lib/videos/rules.ts). Run: npm run test:videos
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  baselineId, cleanFilename, confirmedAll, contentDisposition, isRecordedDate, parseEditInput, parseIdList,
  parseUploadInput, planRotation, sniffMatches, videoMime, MAX_VIDEO_BYTES, VIDEO_LIMIT,
} from "../lib/videos/rules";

const clip = (id: string, recordedDate: string, createdAt = `${recordedDate} 12:00:00+00`) => ({ id, recordedDate, createdAt });
const TODAY = new Date("2026-10-29T15:00:00Z");

test("limit is 5", () => assert.equal(VIDEO_LIMIT, 5));

test("videoMime: known types, m4v, generic MIME falls back to extension, others refused", () => {
  assert.equal(videoMime("video/mp4", "a.mp4"), "video/mp4");
  assert.equal(videoMime("video/quicktime", "IMG_1.MOV"), "video/quicktime");
  assert.equal(videoMime("video/x-m4v", "a.m4v"), "video/mp4");
  assert.equal(videoMime("", "IMG_0001.MOV"), "video/quicktime");
  assert.equal(videoMime("application/octet-stream", "clip.webm"), "video/webm");
  assert.equal(videoMime("", "clip.M4V"), "video/mp4");
  assert.equal(videoMime("video/x-msvideo", "a.mp4"), null); // conflicting unsupported type is not accepted
  assert.equal(videoMime("", "notes.txt"), null);
});

test("sniffMatches: container signatures", () => {
  const box = (t: string) => new Uint8Array([0, 0, 0, 0x20, ...[...t].map((c) => c.charCodeAt(0)), 0, 0, 0, 0]);
  assert.ok(sniffMatches("video/mp4", box("ftyp")));
  assert.ok(sniffMatches("video/quicktime", box("wide")));
  assert.ok(sniffMatches("video/quicktime", box("moov")));
  assert.ok(!sniffMatches("video/mp4", box("PK\u0003\u0004")));
  assert.ok(sniffMatches("video/webm", new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1])));
  assert.ok(!sniffMatches("video/webm", box("ftyp")));
  assert.ok(!sniffMatches("video/mp4", new Uint8Array([1, 2])));
});

test("isRecordedDate: real calendar dates only, not in the future", () => {
  assert.ok(isRecordedDate("2026-10-29", TODAY));
  assert.ok(isRecordedDate("2024-02-29", TODAY));
  assert.ok(!isRecordedDate("2026-02-30", TODAY));
  assert.ok(!isRecordedDate("2026-13-01", TODAY));
  assert.ok(!isRecordedDate("10/29/2026", TODAY));
  assert.ok(!isRecordedDate("2026-11-05", TODAY));
});

test("baseline is the oldest clip (date, then upload time, then id)", () => {
  assert.equal(baselineId([]), null);
  assert.equal(baselineId([clip("b", "2026-05-01"), clip("a", "2025-01-10"), clip("c", "2026-09-01")]), "a");
  assert.equal(baselineId([clip("x", "2025-01-10", "2025-01-10 15:00"), clip("y", "2025-01-10", "2025-01-10 09:00")]), "y");
});

test("planRotation: under the cap fits", () => {
  const four = ["2025-01-01", "2025-06-01", "2026-01-01", "2026-03-01"].map((d, i) => clip(`c${i}`, d));
  assert.deepEqual(planRotation(four, clip("new", "2026-10-01")), { kind: "fits" });
});

test("planRotation: at the cap keeps baseline + 4 newest, rotates the oldest recent", () => {
  const five = [clip("base", "2024-11-01"), clip("r1", "2025-06-01"), clip("r2", "2026-01-01"), clip("r3", "2026-03-01"), clip("r4", "2026-08-01")];
  const plan = planRotation(five, clip("new", "2026-10-28"));
  assert.equal(plan.kind, "rotate");
  assert.deepEqual(plan.kind === "rotate" && plan.evict.map((e) => e.id), ["r1"]);
  // input order doesn't matter
  const shuffled = [five[3], five[0], five[4], five[2], five[1]];
  const again = planRotation(shuffled, clip("new", "2026-10-28"));
  assert.deepEqual(again.kind === "rotate" && again.evict.map((e) => e.id), ["r1"]);
});

test("planRotation: a clip older than every recent one (but not the oldest) is refused", () => {
  const five = [clip("base", "2024-11-01"), clip("r1", "2025-06-01"), clip("r2", "2026-01-01"), clip("r3", "2026-03-01"), clip("r4", "2026-08-01")];
  const plan = planRotation(five, clip("new", "2025-02-01"));
  assert.equal(plan.kind, "too_old");
  assert.equal(plan.kind === "too_old" && plan.oldestRecent.id, "r1");
});

test("planRotation: a clip older than the baseline becomes the baseline", () => {
  const five = [clip("base", "2024-11-01"), clip("r1", "2025-06-01"), clip("r2", "2026-01-01"), clip("r3", "2026-03-01"), clip("r4", "2026-08-01")];
  const plan = planRotation(five, clip("older", "2023-04-01"));
  assert.equal(plan.kind, "rotate");
  // old baseline is now the oldest of the "recent" group, so it is the one rotated out
  assert.deepEqual(plan.kind === "rotate" && plan.evict.map((e) => e.id), ["base"]);
});

test("planRotation: over the cap (after an athlete merge) trims back to the limit", () => {
  const seven = ["2024-01-01", "2024-06-01", "2025-01-01", "2025-06-01", "2026-01-01", "2026-03-01", "2026-05-01"].map((d, i) => clip(`c${i}`, d));
  const plan = planRotation(seven, clip("new", "2026-10-01"));
  assert.deepEqual(plan.kind === "rotate" && plan.evict.map((e) => e.id).sort(), ["c1", "c2", "c3"]);
});

test("same-day clips are ordered by upload time", () => {
  const five = [clip("base", "2026-10-01", "2026-10-01 08:00"), clip("a", "2026-10-01", "2026-10-01 09:00"), clip("b", "2026-10-01", "2026-10-01 10:00"), clip("c", "2026-10-01", "2026-10-01 11:00"), clip("d", "2026-10-01", "2026-10-01 12:00")];
  const plan = planRotation(five, clip("new", "2026-10-01", "2026-10-01 13:00"));
  assert.deepEqual(plan.kind === "rotate" && plan.evict.map((e) => e.id), ["a"]);
});

const valid = {
  clientKey: "0b6a8c1e-1f7a-4c71-9a0e-0f6c1f9b2a11", athleteUuid: "a1b2c3", category: "Pitching", title: "  Bullpen FB  ",
  notes: " look at the lead leg ", recordedDate: "2026-10-28", filename: "C:\\Users\\x\\IMG_0001.MOV", mime: "", size: 12_345_678,
};

test("parseUploadInput: trims, maps MIME by extension, strips path from filename", () => {
  const r = parseUploadInput(valid, TODAY);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.title, "Bullpen FB");
  assert.equal(r.value.notes, "look at the lead leg");
  assert.equal(r.value.mime, "video/quicktime");
  assert.equal(r.value.filename, "IMG_0001.MOV");
  assert.deepEqual(r.value.confirmReplaceIds, []);
});

test("parseUploadInput: rejects bad fields", () => {
  const bad = (patch: Record<string, unknown>) => parseUploadInput({ ...valid, ...patch }, TODAY).ok;
  assert.equal(bad({ clientKey: "x" }), false);
  assert.equal(bad({ athleteUuid: "../etc" }), false);
  assert.equal(bad({ category: "Fielding" }), false);
  assert.equal(bad({ title: "   " }), false);
  assert.equal(bad({ title: "x".repeat(161) }), false);
  assert.equal(bad({ notes: "x".repeat(2001) }), false);
  assert.equal(bad({ recordedDate: "2026-02-31" }), false);
  assert.equal(bad({ size: 0 }), false);
  assert.equal(bad({ size: MAX_VIDEO_BYTES + 1 }), false);
  assert.equal(bad({ size: 1.5 }), false);
  assert.equal(bad({ filename: "notes.txt", mime: "" }), false);
  assert.equal(bad({ confirmReplaceIds: ["nope"] }), false);
  assert.equal(bad({ confirmReplaceIds: [valid.clientKey] }), true);
});

test("parseEditInput: only sent fields, validated", () => {
  assert.deepEqual(parseEditInput({ title: " New " }, TODAY), { ok: true, value: { title: "New" } });
  assert.equal(parseEditInput({}, TODAY).ok, false);
  assert.equal(parseEditInput({ category: "Hitting", recordedDate: "2026-02-30" }, TODAY).ok, false);
  assert.equal(parseEditInput({ notes: "" }, TODAY).ok, true);
});

test("confirmations and id lists", () => {
  assert.deepEqual(parseIdList(undefined), []);
  assert.equal(parseIdList("x"), null);
  assert.ok(confirmedAll([], []));
  assert.ok(confirmedAll(["AA"], ["aa"]));
  assert.ok(!confirmedAll(["a", "b"], ["a"]));
});

test("filenames and Content-Disposition", () => {
  assert.equal(cleanFilename('../../evil"name.mov'), "evilname.mov");
  assert.equal(cleanFilename(""), "video");
  assert.equal(contentDisposition("attachment", "Rück 1.mov"), `attachment; filename="R_ck 1.mov"; filename*=UTF-8''R%C3%BCck%201.mov`);
});
