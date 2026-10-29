// Pure-logic tests for the Client Hub (lib/client-hub). Run: npm run test:client-hub
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideLinks, warehouseNormalizedName } from "../lib/client-hub/matching";
import { lastNewSessionDate, lastWeek, tally } from "../lib/client-hub/checkoffs";
import { buildRow, coverageFor, filterAndSort, headlineStats, onboardingFor } from "../lib/client-hub/flags";
import { autoOnboarding, assessmentStatus, checklistFor } from "../lib/client-hub/assessmentRules";
import { addDays } from "../lib/client-hub/dates";
import type { AppUser, CalendarDay, HubClient } from "../lib/client-hub/types";

const user = (id: string, name: string, email: string | null = null): AppUser => ({ id, name, email, programs: [] });
const athlete = (athleteUuid: string, name: string, extra: { email?: string; appDbUuid?: string } = {}) => ({
  athleteUuid, name, normalizedName: warehouseNormalizedName(name), email: extra.email ?? null, appDbUuid: extra.appDbUuid ?? null,
});

test("warehouseNormalizedName matches the Python normalize_name_for_matching", () => {
  assert.equal(warehouseNormalizedName("Weiss, Ryan 11-25"), "RYAN WEISS");
  assert.equal(warehouseNormalizedName("Crider. Carson"), "CARSON CRIDER");
  assert.equal(warehouseNormalizedName("  zach   davis "), "ZACH DAVIS");
  // Python quirks reproduced on purpose (normalized_name is UNIQUE, so both sides must agree):
  assert.equal(warehouseNormalizedName("Ryan_Weiss 2025-10-14"), "RYAN WEISS 20");
  assert.equal(warehouseNormalizedName("O'Neil, Shea"), "SHEA O'NEIL");
  assert.equal(warehouseNormalizedName("J.T. Realmuto"), "T. REALMUTO J");
  assert.equal(warehouseNormalizedName("Jake Smith Jr."), "JAKE SMITH JR.");
});

test("decideLinks: app id > email > unique name (nicknames) > review near-duplicates > create", () => {
  const athletes = [
    athlete("a1", "Thomas Greer", { appDbUuid: "u1" }),
    athlete("a2", "Zachary Davis"),
    athlete("a3", "Blake Vestal", { email: "bv@x.com" }),
    athlete("a4", "John Lipscomb"),
    athlete("a5", "Chris Smith", { appDbUuid: "someone-else" }),
  ];
  const users = [
    user("u1", "Thomas Greer"), user("u2", "Zach Davis"), user("u3", "B Vestal", "BV@x.com"),
    user("u4", "Jack Lipscomb"), user("u5", "Samuel Highfill"), user("u6", "Chris Smith"),
  ];
  const d = decideLinks(users, athletes, []);
  assert.deepEqual(d.get("u1"), { kind: "link", athleteUuid: "a1", method: "app_db_uuid", setAppDbUuid: false });
  assert.deepEqual(d.get("u2"), { kind: "link", athleteUuid: "a2", method: "name", setAppDbUuid: true });
  assert.deepEqual(d.get("u3"), { kind: "link", athleteUuid: "a3", method: "email", setAppDbUuid: true });
  assert.equal(d.get("u4")?.kind, "review");
  assert.deepEqual(d.get("u5"), { kind: "create", normalizedName: "SAMUEL HIGHFILL" });
  // Same name, but that athlete belongs to another app account: never steal it, never duplicate the name.
  assert.equal(d.get("u6")?.kind, "review");
});

test("decideLinks: two app users with the same name are not auto-linked; existing links and coach links are kept", () => {
  const athletes = [athlete("a1", "Jake Miller"), athlete("a2", "Sam Lee")];
  const users = [user("u1", "Jake Miller"), user("u2", "Jake Miller"), user("u3", "Sam Lee"), user("u4", "Pat Doe")];
  const d = decideLinks(users, athletes, [
    { id: "c3", appUserId: "u3", athleteUuid: "a2", linkMethod: "name" },
    { id: "c4", appUserId: "u4", athleteUuid: null, linkMethod: "coach" },
  ]);
  assert.equal(d.get("u1")?.kind, "review");
  assert.equal(d.get("u2")?.kind, "review");
  assert.deepEqual(d.get("u3"), { kind: "keep", athleteUuid: "a2" });
  assert.deepEqual(d.get("u4"), { kind: "keep", athleteUuid: null });
});

const day = (date: string, activities: CalendarDay["activities"]): CalendarDay => ({ date, activities });
const sets = (completedSets: number, plannedSets: number, unknownSets = 0) => ({ completedSets, plannedSets, unknownSets });

test("tally counts flagged sets only and skips untracked throwing", () => {
  const t = tally([
    day("2026-10-19", [
      { kind: "lift", name: "Squat", completion: sets(0, 3, 3) },
      { kind: "plyo", name: "Plyo A", completion: sets(5, 5) },
      { kind: "throwing", name: "Long toss", completion: null },
    ]),
    day("2026-10-20", [{ kind: "prep", name: null, completion: sets(0, 12) }]),
  ]);
  assert.deepEqual(t, { done: 5, trackable: 17, lastTick: "2026-10-19" });
  assert.equal(lastWeek([day("2026-10-14", []), day("2026-10-15", [])], "2026-10-21").length, 1);
});

test("lastNewSessionDate finds the latest day a new session name appeared", () => {
  const days: CalendarDay[] = [];
  for (let i = 0; i < 30; i++) {
    const date = addDays("2026-09-20", i);
    days.push(day(date, [{ kind: "lift", name: i < 20 ? "Block 1" : "Block 2", completion: null }]));
  }
  assert.equal(lastNewSessionDate(days, "lift", "2026-10-30"), addDays("2026-09-20", 20));
  assert.equal(lastNewSessionDate(days, "plyo", "2026-10-30"), null);
});

const client = (over: Partial<HubClient> = {}): HubClient => ({
  id: "c1", athleteUuid: "a1", appUserId: "u1", name: "Test Client", email: null, linkMethod: "name", linkReview: false, linkCandidates: null,
  autoStatus: "active", statusOverride: null, status: "active", isActive: true, statusChangedAt: null, phase: null, scheduleNote: null,
  coachName: null, ownerClerkUserId: null, ownerName: null, throws: null, position: null, team: null, contractDuration: null,
  contractStart: null, contractEnd: null, contractStatus: "NOT_SENT", onbAssessment: false, onb3d: false, onbReview: false,
  lastContacted: null, nextAssessmentDue: null, needsReview: false, updPlyos: "2026-10-01", updPlyosSource: "app", updLifts: "2026-10-01",
  updLiftsSource: "app", updDelivery: "2026-10-01", updDeliverySource: "app", weekDone: 3, weekTrackable: 10, lastTick: null,
  lastScheduled: "2026-11-30", syncedAt: "2026-10-21T10:00:00Z", createdAt: "", updatedAt: "", updatedBy: null, periodId: 1,
  programName: "Remote", programType: "REMOTE", programCoaches: [], periodStart: "2026-09-01", periodEnd: "2027-03-01",
  periodSpanDays: 182, periodDaysLeft: 131, periodCount: 1, clientSince: "2026-09-01", ...over,
});
const today = "2026-10-21";

test("coverage: ran out, nothing scheduled, inactive", () => {
  assert.equal(coverageFor(client({ lastScheduled: "2026-10-17" }), today).tone, "bad");
  assert.equal(coverageFor(client({ lastScheduled: "2026-10-25" }), today).tone, "warn");
  assert.equal(coverageFor(client({ lastScheduled: null }), today).label, "Nothing scheduled");
  assert.equal(coverageFor(client({ isActive: false, status: "expired" }), today).label, "—");
});

test("assessment checklist: database sessions and coach checks both count; onboarding follows it", () => {
  const dates = new Map([["athletic_screen", ["2026-08-15"]], ["hitting_3d", ["2026-09-20"]], ["mobility", ["2025-01-01"]]]) as Parameters<typeof checklistFor>[0];
  const check = (kind: string, programId: number | null, checkDate: string) =>
    ({ id: 1, programId, kind, status: "done", checkDate, note: null, createdBy: "Ryan", createdAt: "" }) as Parameters<typeof checklistFor>[1][number];
  const list = checklistFor(dates, [check("proteus", 7, "2026-10-01"), check("mobility", 3, "2025-01-02")], "2026-09-01", 7);
  const by = Object.fromEntries(list.map((c) => [c.kind, c]));
  assert.deepEqual(list.map((c) => c.label), ["Mobility", "Proteus", "3D", "Athletic screen"]);
  assert.equal(by.athletic_screen.auto, "2026-08-15", "within 30 days before the program counts");
  assert.equal(by.pitching_3d.auto, "2026-09-20", "hitting 3D counts as 3D");
  assert.equal(by.proteus.done, true); assert.equal(by.proteus.manual, "2026-10-01"); assert.equal(by.proteus.manualBy, "Ryan");
  assert.equal(by.mobility.done, false, "old session and a check from another program don't count");
  assert.equal(by.mobility.last, "2025-01-01");
  assert.deepEqual(autoOnboarding(list), { assessment: true, threeD: true });
  const o = onboardingFor(client(), autoOnboarding(list));
  assert.deepEqual([o.assessment, o.threeD, o.review], [true, true, false]);
  const s = assessmentStatus(dates, [], "2026-09-01", today);
  assert.equal(s.find((x) => x.kind === "athletic_screen")?.inPeriod.length, 0);
});

test("rows: filters, sort by coverage, stats", () => {
  const extra = { onboarding: onboardingFor(client(), { assessment: true, threeD: true }), lastAssessment: "2026-09-10", checklist: [], isMine: false };
  const rows = [
    buildRow(client({ id: "x", name: "Late", lastScheduled: "2026-10-19" }), extra, today),
    buildRow(client({ id: "y", name: "Fine", programType: "IN_HOUSE" }), extra, today),
    buildRow(client({ id: "z", name: "Gone", status: "expired", isActive: false, periodEnd: "2026-01-01", periodDaysLeft: -293 }), extra, today),
  ];
  assert.deepEqual(filterAndSort(rows, { status: "active", types: [], focus: null, query: "" }).map((r) => r.name), ["Late", "Fine"]);
  assert.deepEqual(filterAndSort(rows, { status: "active", types: ["REMOTE"], focus: null, query: "" }).map((r) => r.name), ["Late"]);
  assert.deepEqual(filterAndSort(rows, { status: "expired", types: [], focus: null, query: "" }).map((r) => r.name), ["Gone"]);
  assert.deepEqual(filterAndSort(rows, { status: "active", types: [], focus: "program", query: "" }).map((r) => r.name), ["Late"]);
  const st = headlineStats(rows);
  assert.deepEqual([st.active, st.expired, st.programmingEnds7, st.onboardingOpen], [2, 1, 1, 2]);
});
