// Blast sensor assignments for the coach portal (/coach/blast).
//
// The hitting coach says "sensor 664 is on John Smith" here; the nightly Blast CSV loader
// (uais/python/blast/load_blast_csv.py) gives every swing on 664 after that to John until the
// sensor is reassigned, ended, or goes idle (hitting_intel.blast_idle_minutes()).
// Schema: uais/sql/create_hitting_intel_schema.sql (npm run blast:setup).
//
// Writes go through one transaction each and lean on two partial unique indexes
// (one live assignment per sensor, one live sensor per athlete), so two phones tapping at
// once can't produce overlapping assignments: the loser gets a 409 and refreshes.
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { personKey, warehouseNormalizedName } from "@/lib/client-hub/matching";

export const BLAST_TZ = "America/New_York";

export type Actor = { clerkUserId: string; name: string };

export class BlastError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "BlastError";
  }
}

export class BlastNotInstalledError extends Error {
  constructor() {
    super("The Blast tables are missing. Run `npm run blast:setup` (uais/sql/create_hitting_intel_schema.sql) against the warehouse.");
    this.name = "BlastNotInstalledError";
  }
}

/** Missing hitting_intel relation → BlastNotInstalledError; unique-index races → 409. */
async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof BlastError) throw err;
    const msg = String((err as Error)?.message ?? err);
    if (msg.includes("3F000") || (msg.includes("hitting_intel") && (msg.includes("does not exist") || msg.includes("42P01") || msg.includes("42883")))) {
      throw new BlastNotInstalledError();
    }
    if (msg.includes("uq_blast_assign_open_sensor")) throw new BlastError(409, "That sensor was just assigned by someone else. Refresh and try again.");
    if (msg.includes("uq_blast_assign_open_athlete")) throw new BlastError(409, "That athlete is already on another sensor. End that one first.");
    if (msg.includes("blast_sensors_label_key")) throw new BlastError(409, "Another sensor already uses that number.");
    throw err;
  }
}

type Tx = Pick<typeof prisma, "$queryRawUnsafe" | "$executeRawUnsafe">;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface BlastAssignmentRow {
  id: number;
  sensorSerial: string;
  sensorLabel: string;
  athleteUuid: string;
  athleteName: string;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  voided: boolean;
  assignedByName: string | null;
  note: string | null;
}

export interface BlastSensorState {
  serial: string;
  label: string;
  active: boolean;
  lastSwingAt: string | null;
  current: BlastAssignmentRow | null;
}

export interface BlastState {
  sensors: BlastSensorState[];
  today: BlastAssignmentRow[];
  idleMinutes: number;
  graceSeconds: number;
  lastLoadAt: string | null;
  needsReview: Array<{ localDate: string; sensorLabel: string; status: string; swings: number }>;
}

const ASSIGNMENT_SELECT = `
  SELECT a.id::int AS id, a.sensor_serial AS "sensorSerial", s.label AS "sensorLabel",
         a.athlete_uuid AS "athleteUuid", d.name AS "athleteName",
         a.started_at AS "startedAt", a.ended_at AS "endedAt", a.end_reason AS "endReason",
         a.voided, a.assigned_by_name AS "assignedByName", a.note
    FROM hitting_intel.blast_assignments a
    JOIN hitting_intel.blast_sensors s ON s.serial = a.sensor_serial
    JOIN analytics.d_athletes d ON d.athlete_uuid = a.athlete_uuid`;

type RawAssignment = Omit<BlastAssignmentRow, "startedAt" | "endedAt"> & { startedAt: Date; endedAt: Date | null };
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
const toRow = (r: RawAssignment): BlastAssignmentRow => ({ ...r, startedAt: iso(r.startedAt)!, endedAt: iso(r.endedAt) });

/**
 * Assignments left on overnight end at midnight of the day they started: a sensor
 * is never still "on" an athlete the next day. Run before every read and write.
 */
async function closeStaleDays(tx: Tx) {
  const rows = await tx.$queryRawUnsafe<Array<{ id: number }>>(
    `UPDATE hitting_intel.blast_assignments
        SET ended_at = ((started_at AT TIME ZONE '${BLAST_TZ}')::date + 1)::timestamp AT TIME ZONE '${BLAST_TZ}',
            end_reason = 'day_end', ended_by = 'system', ended_by_name = 'End of day', updated_at = now()
      WHERE ended_at IS NULL AND NOT voided
        AND (started_at AT TIME ZONE '${BLAST_TZ}')::date < (now() AT TIME ZONE '${BLAST_TZ}')::date
      RETURNING id::int AS id`,
  );
  for (const r of rows) await logEvent(tx, r.id, { clerkUserId: "system", name: "End of day" }, "day_end", null);
}

export async function getState(): Promise<BlastState> {
  return guard(async () => {
    await closeStaleDays(prisma);
    const [sensors, open, today, settings, lastLoad, review] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ serial: string; label: string; active: boolean; lastSwingAt: Date | null }>>(
        `SELECT serial, label, active, last_swing_at AS "lastSwingAt" FROM hitting_intel.blast_sensors
          ORDER BY active DESC, label`,
      ),
      prisma.$queryRawUnsafe<RawAssignment[]>(`${ASSIGNMENT_SELECT} WHERE a.ended_at IS NULL AND NOT a.voided`),
      prisma.$queryRawUnsafe<RawAssignment[]>(
        `${ASSIGNMENT_SELECT}
          WHERE (a.started_at AT TIME ZONE '${BLAST_TZ}')::date = (now() AT TIME ZONE '${BLAST_TZ}')::date
          ORDER BY a.started_at DESC, a.id DESC LIMIT 200`,
      ),
      prisma.$queryRawUnsafe<Array<{ idle: number; grace: number }>>(
        `SELECT hitting_intel.blast_idle_minutes() AS idle, hitting_intel.blast_grace_seconds() AS grace`,
      ),
      prisma.$queryRawUnsafe<Array<{ at: Date | null }>>(
        `SELECT max(finished_at) AS at FROM hitting_intel.ingest_runs WHERE source = 'blast_csv' AND status IN ('ok', 'flagged')`,
      ),
      prisma.$queryRawUnsafe<Array<{ localDate: string; sensorLabel: string; status: string; swings: number }>>(
        `SELECT w.local_date::text AS "localDate", s.label AS "sensorLabel", w.attribution AS status, count(*)::int AS swings
           FROM hitting_intel.blast_swings w JOIN hitting_intel.blast_sensors s ON s.serial = w.sensor_serial
          WHERE w.attribution IN ('stale', 'unassigned', 'conflict')
            AND w.local_date >= (now() AT TIME ZONE '${BLAST_TZ}')::date - 7
          GROUP BY 1, 2, 3 ORDER BY 1 DESC, 2`,
      ),
    ]);
    const openBySensor = new Map(open.map((a) => [a.sensorSerial, toRow(a)]));
    return {
      sensors: sensors.map((s) => ({ ...s, lastSwingAt: iso(s.lastSwingAt), current: openBySensor.get(s.serial) ?? null })),
      today: today.map(toRow),
      idleMinutes: Number(settings[0]?.idle ?? 20),
      graceSeconds: Number(settings[0]?.grace ?? 120),
      lastLoadAt: iso(lastLoad[0]?.at ?? null),
      needsReview: review,
    };
  });
}

// ---------------------------------------------------------------------------
// Assignment writes
// ---------------------------------------------------------------------------

async function logEvent(tx: Tx, assignmentId: number, actor: Actor, action: string, detail: Record<string, unknown> | null) {
  await tx.$executeRawUnsafe(
    `INSERT INTO hitting_intel.blast_assignment_events (assignment_id, action, actor, actor_name, detail) VALUES ($1, $2, $3, $4, $5::jsonb)`,
    assignmentId, action, actor.clerkUserId, actor.name, detail ? JSON.stringify(detail) : null,
  );
}

async function athleteName(tx: Tx, athleteUuid: string): Promise<string> {
  const rows = await tx.$queryRawUnsafe<Array<{ name: string }>>(`SELECT name FROM analytics.d_athletes WHERE athlete_uuid = $1`, athleteUuid);
  if (!rows[0]) throw new BlastError(404, "Athlete not found");
  return rows[0].name;
}

/** End an open assignment now. A row that started this same instant is voided instead (ended_at must be later). */
async function endOpen(tx: Tx, id: number, actor: Actor, reason: "ended" | "reassigned" | "moved", detail: Record<string, unknown> | null) {
  const n = await tx.$executeRawUnsafe(
    `UPDATE hitting_intel.blast_assignments
        SET ended_at = now(), end_reason = $2, ended_by = $3, ended_by_name = $4, updated_at = now()
      WHERE id = $1 AND ended_at IS NULL AND NOT voided AND started_at < now()`,
    id, reason, actor.clerkUserId, actor.name,
  );
  if (!n) {
    await tx.$executeRawUnsafe(`UPDATE hitting_intel.blast_assignments SET voided = true, updated_at = now() WHERE id = $1 AND ended_at IS NULL`, id);
  }
  await logEvent(tx, id, actor, reason === "ended" ? "end" : reason === "moved" ? "move" : "reassign", detail);
}

/**
 * "Sensor X is now on athlete Y." Ends whatever X was on (reassigned) and, if Y was on
 * another sensor, ends that one too (moved). Same athlete on the same sensor = no change.
 */
export async function assignSensor(sensorSerial: string, athleteUuid: string, note: string | null, actor: Actor) {
  return guard(() =>
    prisma.$transaction(async (tx) => {
      await closeStaleDays(tx);
      const sensor = await tx.$queryRawUnsafe<Array<{ serial: string; label: string; active: boolean }>>(
        `SELECT serial, label, active FROM hitting_intel.blast_sensors WHERE serial = $1 FOR UPDATE`, sensorSerial,
      );
      if (!sensor[0]) throw new BlastError(404, "Sensor not found");
      if (!sensor[0].active) throw new BlastError(409, `Sensor ${sensor[0].label} is retired.`);
      const name = await athleteName(tx, athleteUuid);
      const onSensor = await tx.$queryRawUnsafe<Array<{ id: number; athleteUuid: string }>>(
        `SELECT id::int AS id, athlete_uuid AS "athleteUuid" FROM hitting_intel.blast_assignments
          WHERE sensor_serial = $1 AND ended_at IS NULL AND NOT voided`, sensorSerial,
      );
      if (onSensor[0]?.athleteUuid === athleteUuid) return { id: onSensor[0].id, unchanged: true };
      if (onSensor[0]) await endOpen(tx, onSensor[0].id, actor, "reassigned", { to: athleteUuid, toName: name });
      const elsewhere = await tx.$queryRawUnsafe<Array<{ id: number; label: string }>>(
        `SELECT a.id::int AS id, s.label FROM hitting_intel.blast_assignments a
           JOIN hitting_intel.blast_sensors s ON s.serial = a.sensor_serial
          WHERE a.athlete_uuid = $1 AND a.ended_at IS NULL AND NOT a.voided FOR UPDATE OF a`, athleteUuid,
      );
      if (elsewhere[0]) await endOpen(tx, elsewhere[0].id, actor, "moved", { toSensor: sensorSerial });
      const created = await tx.$queryRawUnsafe<Array<{ id: number }>>(
        `INSERT INTO hitting_intel.blast_assignments (sensor_serial, athlete_uuid, assigned_by, assigned_by_name, note)
         VALUES ($1, $2, $3, $4, $5) RETURNING id::int AS id`,
        sensorSerial, athleteUuid, actor.clerkUserId, actor.name, note,
      );
      await logEvent(tx, created[0].id, actor, "assign", { sensor: sensor[0].label, athlete: name, movedFrom: elsewhere[0]?.label ?? null });
      return { id: created[0].id, unchanged: false, movedFrom: elsewhere[0]?.label ?? null };
    }),
  );
}

export type AssignmentAction = { action: "end" } | { action: "void" } | { action: "change_athlete"; athleteUuid: string };

/** End it, void it (entered by mistake), or fix who it was (wrong athlete picked). Swings follow on the next nightly run. */
export async function updateAssignment(id: number, body: AssignmentAction, actor: Actor) {
  return guard(() =>
    prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: number; athleteUuid: string; endedAt: Date | null; voided: boolean }>>(
        `SELECT id::int AS id, athlete_uuid AS "athleteUuid", ended_at AS "endedAt", voided
           FROM hitting_intel.blast_assignments WHERE id = $1 FOR UPDATE`, id,
      );
      const a = rows[0];
      if (!a) throw new BlastError(404, "Assignment not found");
      if (a.voided) throw new BlastError(409, "That assignment was already removed.");
      if (body.action === "end") {
        if (a.endedAt) return { id, unchanged: true };
        await endOpen(tx, id, actor, "ended", null);
      } else if (body.action === "void") {
        await tx.$executeRawUnsafe(`UPDATE hitting_intel.blast_assignments SET voided = true, updated_at = now() WHERE id = $1`, id);
        await logEvent(tx, id, actor, "void", null);
      } else {
        if (body.athleteUuid === a.athleteUuid) return { id, unchanged: true };
        const name = await athleteName(tx, body.athleteUuid);
        await tx.$executeRawUnsafe(
          `UPDATE hitting_intel.blast_assignments SET athlete_uuid = $2, updated_at = now() WHERE id = $1`, id, body.athleteUuid,
        );
        await logEvent(tx, id, actor, "change_athlete", { from: a.athleteUuid, to: body.athleteUuid, toName: name });
      }
      return { id, unchanged: false };
    }),
  );
}

// ---------------------------------------------------------------------------
// Sensors
// ---------------------------------------------------------------------------

/** Register a sensor, or rename one the CSV loader auto-registered. */
export async function saveSensor(serial: string, label: string, actor: Actor) {
  return guard(async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO hitting_intel.blast_sensors (serial, label, registered_by) VALUES ($1, $2, $3)
       ON CONFLICT (serial) DO UPDATE SET label = EXCLUDED.label, active = true, updated_at = now()`,
      serial, label, actor.clerkUserId,
    );
  });
}

export async function setSensorActive(serial: string, active: boolean) {
  return guard(async () => {
    if (!active) {
      const open = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
        `SELECT id FROM hitting_intel.blast_assignments WHERE sensor_serial = $1 AND ended_at IS NULL AND NOT voided`, serial,
      );
      if (open[0]) throw new BlastError(409, "End the sensor's current assignment first.");
    }
    const n = await prisma.$executeRawUnsafe(`UPDATE hitting_intel.blast_sensors SET active = $2, updated_at = now() WHERE serial = $1`, serial, active);
    if (!n) throw new BlastError(404, "Sensor not found");
  });
}

// ---------------------------------------------------------------------------
// Athletes: search the whole warehouse, or add a player who isn't in it yet
// ---------------------------------------------------------------------------

export interface BlastAthleteHit {
  athleteUuid: string;
  name: string;
  dateOfBirth: string | null;
  ageGroup: string | null;
  hitting: boolean;     // has hitting 3D trials
  screen: boolean;      // has athletic screen data
  recentBlast: boolean; // on a Blast sensor in the last 30 days
}

const looseTerm = (q: string) => q.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z' -]/g, " ").trim().toUpperCase();

/**
 * Name search over every warehouse athlete. Hitters come first (recent Blast, then hitting
 * 3D, then athletic screen), but anyone can be picked. Empty query = recent Blast athletes.
 */
export async function searchAthletes(q: string, limit = 20): Promise<BlastAthleteHit[]> {
  return guard(async () => {
    const term = looseTerm(q);
    const words = term.split(/\s+/).filter(Boolean).slice(0, 4);
    const lim = Math.max(1, Math.min(50, limit));
    const where = words.length
      ? words.map((_, i) => `(upper(a.name) LIKE '%' || $${i + 1} || '%' OR a.normalized_name LIKE '%' || $${i + 1} || '%')`).join(" AND ")
      : `EXISTS (SELECT 1 FROM hitting_intel.blast_assignments b WHERE b.athlete_uuid = a.athlete_uuid AND NOT b.voided AND b.started_at > now() - interval '30 days')`;
    const rows = await prisma.$queryRawUnsafe<BlastAthleteHit[]>(
      `SELECT * FROM (
         SELECT a.athlete_uuid AS "athleteUuid", a.name, a.date_of_birth::text AS "dateOfBirth", a.age_group AS "ageGroup",
                (COALESCE(a.has_hitting_trial_data, false) OR a.has_hitting_data
                   OR EXISTS (SELECT 1 FROM public.f_hitting_trials h WHERE h.athlete_uuid = a.athlete_uuid)) AS hitting,
                a.has_athletic_screen_data AS screen,
                EXISTS (SELECT 1 FROM hitting_intel.blast_assignments b
                         WHERE b.athlete_uuid = a.athlete_uuid AND NOT b.voided AND b.started_at > now() - interval '30 days') AS "recentBlast"
           FROM analytics.d_athletes a
          WHERE ${where}
       ) x
       ORDER BY x."recentBlast" DESC, x.hitting DESC, x.screen DESC, x.name
       LIMIT ${lim}`,
      ...words,
    );
    return rows;
  });
}

export interface NewAthlete {
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  email: string | null;
  force: boolean;
}

/**
 * Add a player who isn't in the warehouse (origin 'coach_blast', like TrackMan's 'trackman').
 * Exact name clash → 409 with that athlete; a likely-same person (nickname, accents,
 * same last name + first initial) → 409 with candidates unless force.
 */
export async function createAthlete(input: NewAthlete, actor: Actor): Promise<{ athleteUuid: string; name: string }> {
  return guard(async () => {
    const name = `${input.firstName.trim()} ${input.lastName.trim()}`.replace(/\s+/g, " ");
    const normalized = warehouseNormalizedName(name);
    if (!normalized) throw new BlastError(400, "Enter a first and last name.");
    const exact = await prisma.$queryRawUnsafe<BlastAthleteHit[]>(
      `SELECT athlete_uuid AS "athleteUuid", name, date_of_birth::text AS "dateOfBirth" FROM analytics.d_athletes WHERE normalized_name = $1`, normalized,
    );
    if (exact[0]) throw new BlastError(409, `${exact[0].name} is already in the database. Pick them instead.`, { code: "exists", candidates: exact });
    if (!input.force) {
      const last = looseTerm(input.lastName).split(/\s+/).pop() ?? "";
      const pool = last.length >= 2
        ? await prisma.$queryRawUnsafe<Array<{ athleteUuid: string; name: string; dateOfBirth: string | null }>>(
            `SELECT athlete_uuid AS "athleteUuid", name, date_of_birth::text AS "dateOfBirth"
               FROM analytics.d_athletes WHERE normalized_name LIKE '%' || $1 || '%' LIMIT 200`, last,
          )
        : [];
      const key = personKey(name);
      const first = looseTerm(input.firstName)[0];
      const close = pool.filter((a) => {
        if (personKey(a.name) === key) return true;
        const parts = looseTerm(a.name).split(/\s+/);
        const sameLast = parts[parts.length - 1] === last;
        const sameInitial = parts[0]?.[0] === first;
        const sameDob = !!input.dateOfBirth && a.dateOfBirth === input.dateOfBirth;
        return sameLast && (sameInitial || sameDob);
      });
      if (close.length) {
        throw new BlastError(409, "This might be someone already in the database.", { code: "possible_duplicate", candidates: close.slice(0, 8) });
      }
    }
    const uuid = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO analytics.d_athletes (athlete_uuid, name, normalized_name, date_of_birth, email, source_system, source_athlete_id, notes)
       VALUES ($1, $2, $3, $4::date, $5, 'coach_blast', NULL, $6)`,
      uuid, name, normalized, input.dateOfBirth, input.email?.trim().toLowerCase() || null,
      `Added from the coach portal Blast page by ${actor.name}`,
    );
    return { athleteUuid: uuid, name };
  });
}
