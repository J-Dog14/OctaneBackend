import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { badRequest, internalError, success, unauthorized } from "@/lib/responses";

const querySchema = z.object({
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "since must be YYYY-MM-DD"),
});

type Row = { athlete_uuid: string; session_date: Date };

/**
 * Lists sessions that have landed in the warehouse. Read-only: only findMany calls.
 * GET /muse/sessions?since=YYYY-MM-DD
 * Auth: Authorization: Bearer <MUSE_API_TOKEN>
 * Response: Array<{ athlete, session_date, session_type }>
 */
export async function GET(request: NextRequest) {
  const expected = process.env.MUSE_API_TOKEN?.trim();
  if (!expected) {
    return NextResponse.json({ error: "Muse API token not configured" }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return unauthorized("Invalid or missing token");
  }

  const parsed = querySchema.safeParse({
    since: request.nextUrl.searchParams.get("since") ?? undefined,
  });
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((e) => e.message).join(", "));
  }
  const since = new Date(`${parsed.data.since}T00:00:00.000Z`);
  if (Number.isNaN(since.getTime())) {
    return badRequest("since must be a valid date");
  }

  try {
    const query = {
      where: { session_date: { gte: since } },
      select: { athlete_uuid: true, session_date: true },
      distinct: ["athlete_uuid", "session_date"] as ("athlete_uuid" | "session_date")[],
    };

    const sources: Array<[string, Promise<Row[]>]> = [
      ["pitching_3d", prisma.f_pitching_trials.findMany(query)],
      ["pitching_3d", prisma.f_kinematics_pitching.findMany(query)],
      ["hitting_3d", prisma.f_hitting_trials.findMany(query)],
      ["hitting_3d", prisma.f_kinematics_hitting.findMany(query)],
      ["athletic_screen", prisma.f_athletic_screen.findMany(query)],
      ["readiness_screen", prisma.f_readiness_screen.findMany(query)],
      ["mobility", prisma.f_mobility.findMany(query)],
      ["arm_action", prisma.f_arm_action.findMany(query)],
      ["proteus", prisma.f_proteus.findMany(query)],
      ["pro_sup", prisma.f_pro_sup.findMany(query)],
      ["curveball_test", prisma.f_curveball_test.findMany(query)],
    ];
    const results = await Promise.all(sources.map(([, p]) => p));

    // Dedupe: pitching/hitting come from two tables each
    const sessions = new Map<string, { athlete_uuid: string; session_date: string; session_type: string }>();
    results.forEach((rows, i) => {
      const session_type = sources[i][0];
      for (const r of rows) {
        const session_date = r.session_date.toISOString().split("T")[0];
        sessions.set(`${r.athlete_uuid}|${session_date}|${session_type}`, {
          athlete_uuid: r.athlete_uuid,
          session_date,
          session_type,
        });
      }
    });

    const athletes = await prisma.d_athletes.findMany({
      where: { athlete_uuid: { in: [...new Set([...sessions.values()].map((s) => s.athlete_uuid))] } },
      select: { athlete_uuid: true, name: true },
    });
    const nameByUuid = new Map(athletes.map((a) => [a.athlete_uuid, a.name]));

    const out = [...sessions.values()]
      .map((s) => ({
        athlete: nameByUuid.get(s.athlete_uuid) ?? s.athlete_uuid,
        session_date: s.session_date,
        session_type: s.session_type,
      }))
      .sort((x, y) => y.session_date.localeCompare(x.session_date) || x.athlete.localeCompare(y.athlete));

    return success(out);
  } catch (error) {
    console.error("Error in GET /muse/sessions:", error);
    return internalError("Failed to fetch sessions");
  }
}
