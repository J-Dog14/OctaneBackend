import { NextRequest } from "next/server";
import { badRequest, internalError, success } from "@/lib/responses";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { requireRole } from "@/lib/auth/requireAuth";

const querySchema = z.object({
  athleteUuid: z.string().min(1, "athleteUuid is required"),
  reportType: z.string().min(1, "reportType is required"),
});

const toDateStrings = (rows: { session_date: Date }[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const s = r.session_date.toISOString().split("T")[0];
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out.sort((a, b) => b.localeCompare(a)); // newest first
};

/**
 * Athletic Screen is four separate fact tables, one per movement. A session
 * exists on a date if ANY of them has a row — querying only CMJ (as this
 * route used to) hides a date where the athlete did drop jumps but skipped
 * the counter-movement jump, which then can't be picked for a comparison.
 */
type SessionDetail = { date: string; movements: string[] };

const sessionDateQuery = (athleteUuid: string) =>
  ({
    where: { athlete_uuid: athleteUuid },
    select: { session_date: true },
    distinct: ["session_date"],
    orderBy: { session_date: "desc" },
  }) as const;

/**
 * Collects every athletic-screen session date for an athlete, along with
 * which movements were captured on each. Movement order follows the report's
 * own DJ → CMJ → PPU → SLV order so the chips read consistently.
 */
async function athleticScreenSessions(athleteUuid: string): Promise<SessionDetail[]> {
  const q = sessionDateQuery(athleteUuid);
  const [dj, cmj, ppu, slv] = await Promise.all([
    prisma.f_athletic_screen_dj.findMany(q),
    prisma.f_athletic_screen_cmj.findMany(q),
    prisma.f_athletic_screen_ppu.findMany(q),
    prisma.f_athletic_screen_slv.findMany(q),
  ]);

  const byDate = new Map<string, string[]>();
  const perMovement: [string, { session_date: Date }[]][] = [
    ["DJ", dj],
    ["CMJ", cmj],
    ["PPU", ppu],
    ["SLV", slv],
  ];

  for (const [movement, rows] of perMovement) {
    for (const date of toDateStrings(rows)) {
      const existing = byDate.get(date);
      if (existing) existing.push(movement);
      else byDate.set(date, [movement]);
    }
  }

  return Array.from(byDate.entries())
    .map(([date, movements]) => ({ date, movements }))
    .sort((a, b) => b.date.localeCompare(a.date)); // newest first
}

/**
 * Returns available session dates for a given athlete + report type.
 * GET /api/dashboard/reports/sessions?athleteUuid=...&reportType=athletic-screen
 *
 * Response: {
 *   dates: string[],                                  // YYYY-MM-DD, newest first
 *   sessions: { date: string; movements: string[] }[] // athletic-screen only
 * }
 *
 * `dates` is kept for existing callers; `sessions` carries the per-date
 * movement breakdown the comparison picker uses to warn about gaps.
 */
export async function GET(request: NextRequest) {
  await requireRole("admin");
  try {
    const { searchParams } = new URL(request.url);
    const raw = {
      athleteUuid: searchParams.get("athleteUuid") ?? undefined,
      reportType: searchParams.get("reportType") ?? undefined,
    };
    const parsed = querySchema.safeParse(raw);
    if (!parsed.success) {
      return badRequest(parsed.error.issues.map((e) => e.message).join(", "));
    }
    const { athleteUuid, reportType } = parsed.data;

    let dates: string[] = [];
    let sessions: SessionDetail[] = [];

    switch (reportType) {
      case "athletic-screen": {
        sessions = await athleticScreenSessions(athleteUuid);
        dates = sessions.map((s) => s.date);
        break;
      }
      case "pro-sup": {
        const rows = await prisma.f_pro_sup.findMany({
          where: { athlete_uuid: athleteUuid },
          select: { session_date: true },
          distinct: ["session_date"],
          orderBy: { session_date: "desc" },
        });
        dates = toDateStrings(rows);
        break;
      }
      case "arm-action": {
        const rows = await prisma.f_arm_action.findMany({
          where: { athlete_uuid: athleteUuid },
          select: { session_date: true },
          distinct: ["session_date"],
          orderBy: { session_date: "desc" },
        });
        dates = toDateStrings(rows);
        break;
      }
      case "curveball": {
        const rows = await prisma.f_curveball_test.findMany({
          where: { athlete_uuid: athleteUuid },
          select: { session_date: true },
          distinct: ["session_date"],
          orderBy: { session_date: "desc" },
        });
        dates = toDateStrings(rows);
        break;
      }
      default:
        // Unknown report type — return empty rather than erroring
        dates = [];
    }

    if (sessions.length === 0) {
      sessions = dates.map((date) => ({ date, movements: [] }));
    }

    return success({ dates, sessions });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Error in GET /api/dashboard/reports/sessions:", error);
    return internalError("Failed to fetch session dates");
  }
}
