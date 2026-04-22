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
 * Returns available session dates for a given athlete + report type.
 * GET /api/dashboard/reports/sessions?athleteUuid=...&reportType=athletic-screen
 * Response: { dates: string[] }  (YYYY-MM-DD, newest first)
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

    switch (reportType) {
      case "athletic-screen": {
        const rows = await prisma.f_athletic_screen_cmj.findMany({
          where: { athlete_uuid: athleteUuid },
          select: { session_date: true },
          distinct: ["session_date"],
          orderBy: { session_date: "desc" },
        });
        dates = toDateStrings(rows);
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

    return success({ dates });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Error in GET /api/dashboard/reports/sessions:", error);
    return internalError("Failed to fetch session dates");
  }
}
