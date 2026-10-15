import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import { badRequest, internalError, success } from "@/lib/responses";
import { requireCoach } from "@/lib/coach/access";
import { isComparisonScope, TRACKING_DOMAINS } from "@/lib/coach/comparison";
import { athleteDataFilter } from "@/lib/coach/athleteSearch";
import type { DomainId } from "@/lib/athlete-tracking/types";

export const dynamic = "force-dynamic";

const select = {
  athlete_uuid: true,
  name: true,
  age_group: true,
  updated_at: true,
  has_pitching_data: true,
  has_hitting_data: true,
  has_athletic_screen_data: true,
  has_mobility_data: true,
  has_proteus_data: true,
  has_readiness_screen_data: true,
  has_arm_action_data: true,
  has_pro_sup_data: true,
} as const;

/**
 * GET /api/coach/athletes?q=<name>&limit=<n>
 * Name search for the coach suite. Without q, the most recently updated athletes.
 */
export async function GET(request: NextRequest) {
  const denied = await requireCoach();
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim().slice(0, 80);
    const limit = Math.floor(Math.min(Math.max(Number(searchParams.get("limit")) || 25, 1), 60));
    const scope = searchParams.get("scope") ?? "all";
    if (!isComparisonScope(scope)) return badRequest("Unknown comparison scope");
    const domain = searchParams.get("domain");
    if (domain && !TRACKING_DOMAINS.includes(domain as DomainId)) return badRequest("Unknown tracking domain");
    type AthleteRow = Prisma.d_athletesGetPayload<{ select: typeof select }>;
    const rows = scope === "all" && !domain ? await prisma.d_athletes.findMany({
      where: q ? { name: { contains: q, mode: "insensitive" } } : undefined,
      orderBy: q ? { name: "asc" } : { updated_at: "desc" },
      take: limit,
      select,
    }) : await prisma.$queryRaw<AthleteRow[]>(Prisma.sql`
      SELECT ${Prisma.raw(Object.keys(select).map((column) => `a.${column}`).join(", "))}
      FROM analytics.d_athletes a
      WHERE ${q ? Prisma.sql`a.name ILIKE ${`%${q.replace(/[\\%_]/g, "\\$&")}%`}` : Prisma.sql`TRUE`}
        AND ${await athleteDataFilter(scope, domain as DomainId | undefined)}
      ORDER BY ${q ? Prisma.sql`a.name ASC, a.athlete_uuid ASC` : Prisma.sql`a.updated_at DESC, a.athlete_uuid ASC`}
      LIMIT ${limit}
    `);
    return success({
      items: rows.map((r) => ({
        athleteUuid: r.athlete_uuid,
        name: r.name,
        ageGroup: r.age_group,
        updatedAt: r.updated_at.toISOString(),
        has: {
          pitching: r.has_pitching_data,
          hitting: r.has_hitting_data,
          athleticScreen: r.has_athletic_screen_data,
          mobility: r.has_mobility_data,
          proteus: r.has_proteus_data,
          readiness: r.has_readiness_screen_data,
          armAction: r.has_arm_action_data,
          proSup: r.has_pro_sup_data,
        },
      })),
    });
  } catch (error) {
    console.error("Error in GET /api/coach/athletes:", error);
    return internalError("Failed to search athletes");
  }
}
