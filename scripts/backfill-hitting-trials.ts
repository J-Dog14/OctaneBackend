/**
 * Backfill script: populate f_hitting_trials from D:/Hitting/Data
 *
 * Mirrors hitting_processing.R JSON path: reads *-3d-data.json files and stores
 * each as one row in f_hitting_trials with the full raw JSON as the metrics blob.
 *
 * Processes ONE athlete at a time — each athlete gets its own DB transaction,
 * so there is no long-running connection that can be killed by Neon's timeout.
 *
 * Run:
 *   npx tsx scripts/backfill-hitting-trials.ts
 *   npx tsx scripts/backfill-hitting-trials.ts --dry-run   (parse only, no writes)
 *   npx tsx scripts/backfill-hitting-trials.ts --skip-done (skip athletes already in DB)
 */

import fs from "fs";
import path from "path";
import { parseStringPromise } from "xml2js";
import { prisma } from "../lib/db/prisma";

const DATA_ROOT = "D:/Hitting/Data";
const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_DONE = process.argv.includes("--skip-done");

// ── Name normalisation (mirrors the R hitting_processing.R logic) ─────────────
function normalizeName(raw: string): string {
  let name = raw;
  // Remove date patterns
  name = name.replace(/\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/g, "");
  name = name.replace(/\s*\d{4}[/-]\d{1,2}[/-]\d{1,2}/g, "");
  name = name.replace(/\s*\d{4}/g, "");
  // Remove trailing mm-yy or m-yy date suffixes (e.g. "Name 06-25", "Name 9-29")
  name = name.replace(/\s+\d{1,2}-\d{2}\s*$/g, "");
  name = name.trim();
  // Handle "LAST, FIRST" or "LAST. FIRST"
  if (name.includes(",")) {
    const [last, first] = name.split(",").map((s) => s.trim());
    name = `${first} ${last}`;
  } else if (/\w\.\s\w/.test(name)) {
    const parts = name.split(".").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 2) name = `${parts[1]} ${parts[0]}`;
  }
  return name.toUpperCase().replace(/\s+/g, " ").trim();
}

// ── XML helpers for session.xml ───────────────────────────────────────────────
async function readXml(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return await parseStringPromise(content, { explicitArray: true, trim: true });
  } catch {
    return null;
  }
}

interface SessionInfo {
  name: string | null;
  sourceAthleteId: string | null;
  creationDate: string | null;
  dob: string | null;
  height: number | null;  // metres
  weight: number | null;  // kg
}

function parseSessionXml(doc: Record<string, unknown>): SessionInfo {
  try {
    const subject = (doc as any).Subject;
    const fields = subject?.Fields?.[0] ?? subject?.fields?.[0];
    const get = (key: string): string | null => {
      const val = fields?.[key]?.[0] ?? fields?.[key.toLowerCase()]?.[0];
      return val ? String(val).trim() || null : null;
    };
    return {
      name: get("Name"),
      sourceAthleteId: get("ID"),
      creationDate: get("Creation_date"),
      dob: get("Date_of_birth"),
      height: parseFloat(get("Height") ?? "") || null,
      weight: parseFloat(get("Weight") ?? "") || null,
    };
  } catch {
    return { name: null, sourceAthleteId: null, creationDate: null, dob: null, height: null, weight: null };
  }
}

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  for (const fmt of [
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    /^(\d{4})-(\d{2})-(\d{2})$/,
  ]) {
    const m = raw.match(fmt);
    if (m) {
      const [, a, b, c] = m;
      const d = fmt.source.startsWith("^(\\d{4})")
        ? new Date(`${a}-${b}-${c}`)
        : new Date(`${c!}-${a!.padStart(2, "0")}-${b!.padStart(2, "0")}`);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(80));
  console.log("HITTING TRIALS BACKFILL — JSON files → f_hitting_trials");
  if (DRY_RUN) console.log("  DRY RUN — no writes to database");
  if (SKIP_DONE) console.log("  --skip-done: athletes already in DB will be skipped");
  console.log("=".repeat(80));
  console.log();

  if (!fs.existsSync(DATA_ROOT)) {
    console.error(`Data root not found: ${DATA_ROOT}`);
    process.exit(1);
  }

  const athleteDirs = fs
    .readdirSync(DATA_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(DATA_ROOT, d.name));

  console.log(`Found ${athleteDirs.length} athlete folders in ${DATA_ROOT}\n`);

  // Optionally build set of athlete UUIDs already with f_hitting_trials data
  const doneUuids = new Set<string>();
  if (SKIP_DONE) {
    const existing = await prisma.f_hitting_trials.findMany({
      select: { athlete_uuid: true },
      distinct: ["athlete_uuid"],
    });
    existing.forEach((r) => doneUuids.add(r.athlete_uuid));
    console.log(`  ${doneUuids.size} athletes already have f_hitting_trials rows\n`);
  }

  // Load all athletes from d_athletes for name matching
  const allAthletes = await prisma.d_athletes.findMany({
    select: { athlete_uuid: true, normalized_name: true, name: true },
  });
  const byNormalizedName = new Map<string, string>(); // normalized_name → uuid
  for (const a of allAthletes) {
    if (a.normalized_name) byNormalizedName.set(a.normalized_name.toUpperCase(), a.athlete_uuid);
  }
  console.log(`  Loaded ${allAthletes.length} athletes from d_athletes\n`);

  let nOk = 0, nSkipped = 0, nFailed = 0, nNoUuid = 0;
  const failedList: string[] = [];
  const noUuidList: string[] = [];

  for (let i = 0; i < athleteDirs.length; i++) {
    const dir = athleteDirs[i]!;
    const folderName = path.basename(dir);
    const prefix = `[${i + 1}/${athleteDirs.length}] ${folderName}`;

    // Find the sport subfolder
    const sportDir = fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(dir, d.name))[0];
    if (!sportDir) { console.log(`${prefix} -> no sport subfolder, skip`); nSkipped++; continue; }

    // Find *-3d-data.json files
    const jsonFiles = fs.readdirSync(sportDir)
      .filter((f) => f.endsWith("-3d-data.json"))
      .sort()
      .map((f) => path.join(sportDir, f));

    if (jsonFiles.length === 0) {
      console.log(`${prefix} -> no *-3d-data.json files, skip`);
      nSkipped++;
      continue;
    }

    // Parse session.xml for athlete info (name, date, height, weight)
    const sessionXmlPath = path.join(sportDir, "session.xml");
    let sessionInfo: SessionInfo = { name: null, sourceAthleteId: null, creationDate: null, dob: null, height: null, weight: null };
    if (fs.existsSync(sessionXmlPath)) {
      const sessionDoc = await readXml(sessionXmlPath);
      if (sessionDoc) sessionInfo = parseSessionXml(sessionDoc);
    }

    // Determine athlete name for UUID lookup
    const rawName = sessionInfo.name ?? folderName;
    const normalized = normalizeName(rawName);
    let athleteUuid = byNormalizedName.get(normalized);

    // Fuzzy fallback: try folder name too
    if (!athleteUuid) {
      const folderNorm = normalizeName(folderName);
      athleteUuid = byNormalizedName.get(folderNorm);
    }

    if (!athleteUuid) {
      console.log(`${prefix} -> NO UUID MATCH (name="${rawName}", normalized="${normalized}")`);
      nNoUuid++;
      noUuidList.push(`${folderName} (normalized: ${normalized})`);
      continue;
    }

    if (SKIP_DONE && doneUuids.has(athleteUuid)) {
      console.log(`${prefix} -> already in DB, skip`);
      nSkipped++;
      continue;
    }

    // Determine session date
    const sessionDate = parseDate(sessionInfo.creationDate) ?? new Date();

    // Calculate age at collection
    let ageAtCollection: number | null = null;
    let ageGroup: string | null = null;
    const dobDate = parseDate(sessionInfo.dob);
    if (dobDate && sessionDate) {
      ageAtCollection = (sessionDate.getTime() - dobDate.getTime()) / (365.25 * 24 * 3600 * 1000);
      const age = Math.floor(ageAtCollection);
      ageGroup = age < 14 ? "14U" : age < 16 ? "15-16" : age < 18 ? "17-18" : age < 23 ? "College" : "Pro";
    }

    if (DRY_RUN) {
      console.log(`${prefix} -> DRY RUN: would write ${jsonFiles.length} JSON trial(s)`);
      jsonFiles.forEach((f, idx) => {
        const size = fs.statSync(f).size;
        console.log(`    trial ${idx}: ${path.basename(f)} (${(size / 1024).toFixed(0)} KB)`);
      });
      nOk++;
      continue;
    }

    // Write to DB — one upsert per JSON file
    try {
      let written = 0;
      for (let ti = 0; ti < jsonFiles.length; ti++) {
        const jsonPath = jsonFiles[ti]!;
        const rawContent = fs.readFileSync(jsonPath, "utf-8");

        let metricsObj: object;
        try {
          metricsObj = JSON.parse(rawContent);
        } catch {
          console.log(`  [WARN] Invalid JSON: ${path.basename(jsonPath)}, skipping`);
          continue;
        }

        await prisma.f_hitting_trials.upsert({
          where: {
            athlete_uuid_session_date_trial_index: {
              athlete_uuid: athleteUuid,
              session_date: sessionDate,
              trial_index: ti,
            },
          },
          create: {
            athlete_uuid: athleteUuid,
            session_date: sessionDate,
            source_system: "hitting",
            source_athlete_id: sessionInfo.sourceAthleteId ?? undefined,
            owner_filename: path.basename(jsonPath),
            trial_index: ti,
            age_at_collection: ageAtCollection ?? undefined,
            age_group: ageGroup ?? undefined,
            height: sessionInfo.height ? sessionInfo.height * 39.3701 : undefined, // m → inches
            weight: sessionInfo.weight ? sessionInfo.weight * 2.20462 : undefined, // kg → lbs
            metrics: metricsObj,
          },
          update: {
            owner_filename: path.basename(jsonPath),
            source_athlete_id: sessionInfo.sourceAthleteId ?? undefined,
            age_at_collection: ageAtCollection ?? undefined,
            age_group: ageGroup ?? undefined,
            metrics: metricsObj,
          },
        });
        written++;
      }

      console.log(`${prefix} -> OK  ${written} JSON trial(s)`);
      nOk++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`${prefix} -> FAILED: ${msg}`);
      nFailed++;
      failedList.push(folderName);
    }
  }

  // Update d_athletes flags
  if (!DRY_RUN) {
    console.log("\nUpdating athlete data-presence flags...");
    try {
      await prisma.$executeRawUnsafe("SELECT update_athlete_data_flags()");
      console.log("  Flags updated.");
    } catch (e: unknown) {
      console.warn("  Could not update flags:", e instanceof Error ? e.message : e);
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("BACKFILL COMPLETE");
  console.log(`  OK:        ${nOk}`);
  console.log(`  Skipped:   ${nSkipped}`);
  console.log(`  No UUID:   ${nNoUuid}`);
  console.log(`  Failed:    ${nFailed}`);
  if (noUuidList.length) { console.log("\nNo UUID match:"); noUuidList.forEach((n) => console.log("  -", n)); }
  if (failedList.length) { console.log("\nFailed:"); failedList.forEach((n) => console.log("  -", n)); }
  console.log("=".repeat(80));
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
