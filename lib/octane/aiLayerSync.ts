import { prisma } from "@/lib/db/prisma";
import { lookupOctaneUserByEmail } from "@/lib/octane/octaneUserLookup";

/**
 * AI-layer sync to Octane — TypeScript port of OctaneAiLayer's
 * `send-profile` / `send-corpus` CLI commands, so the whole workflow lives in
 * this app's UI (Send to App page) instead of a separate Python CLI.
 *
 * Reads from the warehouse DB:
 *   - ai_layer.athlete_profiles                (built by the ai-layer profiler)
 *   - ai_layer.program_exercise_prescriptions  (built by summarize-all)
 *   - analytics.d_athletes                     (identity + role flags)
 * ai_layer isn't in the Prisma schema, so those go through $queryRaw.
 *
 * Sends to Octane (same auth as send-to-octane):
 *   - POST /api/biomech/profile  → athlete_assessment_profiles (generation trigger)
 *   - POST /api/biomech/corpus   → ai_corpus_* (similarity + candidate pools)
 */

// ─── Shared helpers ───────────────────────────────────────────────────────────

function octaneConfig(): { url: string; apiKey: string } {
  const url = process.env.OCTANE_APP_API_URL;
  const apiKey = process.env.BIOMECH_API_KEYS;
  if (!url || !apiKey) {
    throw new Error(
      "OCTANE_APP_API_URL or BIOMECH_API_KEYS environment variables are not set."
    );
  }
  return { url, apiKey };
}

async function postToOctane(path: string, payload: unknown): Promise<unknown> {
  const { url, apiKey } = octaneConfig();
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`Octane rejected ${path} (${res.status}): ${body}`);
  }
  return res.json();
}

/** JSONB map → { key: number|null }, dropping non-numeric values (Octane's
 *  zod schema accepts number|null only). */
function cleanMetricMap(raw: unknown): Record<string, number | null> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null) out[key] = null;
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "string" && value !== "" && !Number.isNaN(Number(value))) {
      out[key] = Number(value); // numeric strings from JSONB Decimal serialization
    }
  }
  return out;
}

function toDateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/**
 * Role comes from the warehouse fact tables, not profile notes:
 * rows in f_pitching_trials → pitcher, rows in f_hitting_trials → hitter,
 * rows in both → both. Neither → null (caller must handle).
 */
async function deriveRole(
  athleteUuid: string
): Promise<"pitcher" | "hitter" | "both" | null> {
  const [pitching, hitting] = await Promise.all([
    prisma.$queryRaw<Array<{ one: number }>>`
      SELECT 1 AS one FROM public.f_pitching_trials
      WHERE athlete_uuid = ${athleteUuid} LIMIT 1
    `,
    prisma.$queryRaw<Array<{ one: number }>>`
      SELECT 1 AS one FROM public.f_hitting_trials
      WHERE athlete_uuid = ${athleteUuid} LIMIT 1
    `,
  ]);
  const isPitcher = pitching.length > 0;
  const isHitter = hitting.length > 0;
  if (isPitcher && isHitter) return "both";
  if (isPitcher) return "pitcher";
  if (isHitter) return "hitter";
  return null;
}

/** Resolve the athlete's Octane account uuid (cached on d_athletes, same
 *  pattern as send-to-octane). */
async function resolveOctaneIdentity(athleteUuid: string): Promise<
  | { ok: true; email: string; name: string; appDbUuid: string; ageGroup: string | null }
  | { ok: false; error: string }
> {
  const athlete = await prisma.d_athletes.findUnique({
    where: { athlete_uuid: athleteUuid },
    select: {
      name: true,
      email: true,
      app_db_uuid: true,
      age_group: true,
    },
  });
  if (!athlete) return { ok: false, error: "Athlete not found in warehouse" };
  if (!athlete.email) {
    return {
      ok: false,
      error: `Athlete "${athlete.name}" has no email set. Set their email first to link an Octane account.`,
    };
  }

  let appDbUuid = athlete.app_db_uuid;
  if (!appDbUuid) {
    const result = await lookupOctaneUserByEmail(athlete.email);
    if (!result.ok) {
      return {
        ok: false,
        error: `No Octane account found for email "${athlete.email}". The athlete must create an Octane account first.`,
      };
    }
    appDbUuid = result.user.uuid;
    await prisma.d_athletes.update({
      where: { athlete_uuid: athleteUuid },
      data: { app_db_uuid: appDbUuid, app_db_synced_at: new Date() },
    });
  }

  return {
    ok: true,
    email: athlete.email,
    name: athlete.name,
    appDbUuid,
    ageGroup: athlete.age_group ?? null,
  };
}

// ─── Profile status + send ────────────────────────────────────────────────────

interface ProfileRow {
  id: number;
  as_of_date: Date;
  age_group: string | null;
  raw_values: unknown;
  z_scores: unknown;
  source_dates: unknown;
  notes: string | null;
}

export async function getLatestAiProfile(athleteUuid: string): Promise<
  | { exists: true; asOfDate: string; role: string; metricCount: number }
  | { exists: false }
> {
  const rows = await prisma.$queryRaw<ProfileRow[]>`
    SELECT id, as_of_date, age_group, raw_values, z_scores, source_dates, notes
    FROM ai_layer.athlete_profiles
    WHERE athlete_uuid = ${athleteUuid}
    ORDER BY as_of_date DESC
    LIMIT 1
  `;
  if (rows.length === 0) return { exists: false };
  const profile = rows[0];
  const role = await deriveRole(athleteUuid);
  return {
    exists: true,
    asOfDate: toDateString(profile.as_of_date),
    role: role ?? "no trial data",
    metricCount: Object.keys(cleanMetricMap(profile.z_scores)).length,
  };
}

export async function sendAiProfile(athleteUuid: string): Promise<
  | { ok: true; athlete: string; asOfDate: string; metrics: number }
  | { ok: false; error: string }
> {
  const rows = await prisma.$queryRaw<ProfileRow[]>`
    SELECT id, as_of_date, age_group, raw_values, z_scores, source_dates, notes
    FROM ai_layer.athlete_profiles
    WHERE athlete_uuid = ${athleteUuid}
    ORDER BY as_of_date DESC
    LIMIT 1
  `;
  if (rows.length === 0) {
    return {
      ok: false,
      error:
        "No AI profile found for this athlete. Run the profiler (ai-layer `profile`/`backfill`) first.",
    };
  }
  const profile = rows[0];

  const identity = await resolveOctaneIdentity(athleteUuid);
  if (!identity.ok) return identity;

  const zScores = cleanMetricMap(profile.z_scores);
  if (Object.keys(zScores).length === 0) {
    return { ok: false, error: "Profile has an empty z-score map — re-run the profiler." };
  }

  const role = await deriveRole(athleteUuid);
  if (!role) {
    return {
      ok: false,
      error:
        "Athlete has no rows in f_pitching_trials or f_hitting_trials — cannot determine role (pitcher/hitter/both). Run a pitching or hitting assessment first.",
    };
  }

  const sourceDates = profile.source_dates;
  await postToOctane("/api/biomech/profile", {
    octaneUserUuid: identity.appDbUuid,
    athleteEmail: identity.email,
    athleteName: identity.name,
    asOfDate: toDateString(profile.as_of_date),
    role,
    ageGroup:
      (profile.age_group ?? identity.ageGroup)?.trim().toUpperCase() || null,
    rawValues: cleanMetricMap(profile.raw_values),
    zScores,
    sourceDates:
      typeof sourceDates === "object" && sourceDates !== null && !Array.isArray(sourceDates)
        ? (sourceDates as Record<string, string | null>)
        : null,
    source: `ai_layer.athlete_profiles:${profile.id}`,
  });

  return {
    ok: true,
    athlete: identity.name,
    asOfDate: toDateString(profile.as_of_date),
    metrics: Object.keys(zScores).length,
  };
}

// ─── Corpus sync (batched) ────────────────────────────────────────────────────

interface CorpusAthleteRow {
  athlete_uuid: string;
  as_of_date: Date;
  z_scores: unknown;
  age_group: string | null;
  name: string;
  has_pitching_data: boolean | null;
  has_hitting_data: boolean | null;
}

interface PrescriptionRow {
  category: string;
  exercise_name: string;
  exercise_id: string | null;
  exercise_type: string | null;
  n_sets: number | null;
  avg_reps: number | null;
  max_reps: number | null;
  avg_weight: number | null;
  plyo_intensity: number | null;
  plyo_ball_weight: string | null;
  plyo_name: string | null;
}

export async function countCorpusAthletes(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(DISTINCT athlete_uuid)::bigint AS n FROM ai_layer.athlete_profiles
  `;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Send one batch of corpus athletes (keyset pagination by athlete_uuid).
 * The client loops until nextCursor is null. Idempotent per athlete.
 */
export async function sendCorpusBatch(options: {
  cursor?: string | null;
  batchSize?: number;
}): Promise<{
  sent: number;
  failed: Array<{ athlete: string; error: string }>;
  nextCursor: string | null;
}> {
  const { cursor = null, batchSize = 10 } = options;

  const athletes = await prisma.$queryRaw<CorpusAthleteRow[]>`
    SELECT DISTINCT ON (p.athlete_uuid)
           p.athlete_uuid, p.as_of_date, p.z_scores, p.age_group,
           d.name, d.has_pitching_data, d.has_hitting_data
    FROM ai_layer.athlete_profiles p
    JOIN analytics.d_athletes d USING (athlete_uuid)
    WHERE p.athlete_uuid > ${cursor ?? ""}
    ORDER BY p.athlete_uuid, p.as_of_date DESC
    LIMIT ${batchSize}
  `;

  if (athletes.length === 0) {
    return { sent: 0, failed: [], nextCursor: null };
  }

  let sent = 0;
  const failed: Array<{ athlete: string; error: string }> = [];

  for (const athlete of athletes) {
    try {
      const zScores = cleanMetricMap(athlete.z_scores);
      if (Object.keys(zScores).length === 0) continue; // nothing usable

      // Role flags with fact-table staleness fallback (mirrors the Python sender)
      let hasPitching = Boolean(athlete.has_pitching_data);
      let hasHitting = Boolean(athlete.has_hitting_data);
      if (!hasPitching) {
        const rows = await prisma.$queryRaw<Array<{ one: number }>>`
          SELECT 1 AS one FROM public.f_pitching_trials
          WHERE athlete_uuid = ${athlete.athlete_uuid} LIMIT 1
        `;
        hasPitching = rows.length > 0;
      }
      if (!hasHitting) {
        const rows = await prisma.$queryRaw<Array<{ one: number }>>`
          SELECT 1 AS one FROM public.f_hitting_trials
          WHERE athlete_uuid = ${athlete.athlete_uuid} LIMIT 1
        `;
        hasHitting = rows.length > 0;
      }

      const prescriptions = await prisma.$queryRaw<PrescriptionRow[]>`
        SELECT category, exercise_name, exercise_id::text AS exercise_id,
               exercise_type,
               n_sets::float AS n_sets, avg_reps::float AS avg_reps,
               max_reps::float AS max_reps, avg_weight::float AS avg_weight,
               plyo_intensity::int AS plyo_intensity, plyo_ball_weight, plyo_name
        FROM ai_layer.program_exercise_prescriptions
        WHERE athlete_uuid = ${athlete.athlete_uuid}
          AND exercise_name IS NOT NULL
          AND category IN ('lift', 'plyo', 'prep', 'bp', 'hit', 'me')
      `;

      await postToOctane("/api/biomech/corpus", {
        athleteUuid: athlete.athlete_uuid,
        name: athlete.name || "Unknown Athlete",
        ageGroup: athlete.age_group?.trim().toUpperCase() || null,
        hasPitchingData: hasPitching,
        hasHittingData: hasHitting,
        asOfDate: toDateString(athlete.as_of_date),
        zScores,
        prescriptions: prescriptions.map((p) => ({
          category: p.category,
          exerciseName: p.exercise_name,
          exerciseId: p.exercise_id,
          exerciseType: p.exercise_type,
          nSets: p.n_sets,
          avgReps: p.avg_reps,
          maxReps: p.max_reps,
          avgWeight: p.avg_weight,
          plyoIntensity: p.plyo_intensity,
          plyoBallWeight: p.plyo_ball_weight,
          plyoName: p.plyo_name,
        })),
      });
      sent++;
    } catch (err) {
      failed.push({
        athlete: athlete.name || athlete.athlete_uuid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    sent,
    failed,
    nextCursor: athletes[athletes.length - 1].athlete_uuid,
  };
}
