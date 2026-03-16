import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db/prisma";

const athleteListSelect = {
  athlete_uuid: true,
  name: true,
  normalized_name: true,
  email: true,
  date_of_birth: true,
  gender: true,
  age_group: true,
  created_at: true,
  updated_at: true,
  app_db_uuid: true,
  app_db_synced_at: true,
  has_pitching_data: true,
  has_hitting_data: true,
  has_athletic_screen_data: true,
  has_mobility_data: true,
  has_pro_sup_data: true,
  has_proteus_data: true,
  has_readiness_screen_data: true,
  has_arm_action_data: true,
  has_curveball_test_data: true,
  pitching_session_count: true,
  hitting_session_count: true,
  athletic_screen_session_count: true,
  mobility_session_count: true,
  pro_sup_session_count: true,
  proteus_session_count: true,
  readiness_screen_session_count: true,
  arm_action_session_count: true,
  curveball_test_session_count: true,
} as const;

// Cursor token is base64-encoded JSON { name, athlete_uuid } so we can
// skip the extra findUnique() lookup that the old bare-UUID cursor required.
function encodeCursor(name: string, athlete_uuid: string): string {
  return Buffer.from(JSON.stringify({ name, athlete_uuid })).toString("base64");
}

function decodeCursor(
  token: string
): { name: string; athlete_uuid: string } | undefined {
  try {
    return JSON.parse(Buffer.from(token, "base64").toString("utf-8"));
  } catch {
    return undefined;
  }
}

async function _getAthletesList(opts: {
  q?: string;
  limit?: number;
  cursor?: string;
  /** When true, only return athletes with no email (non-app athletes). */
  filterNonApp?: boolean;
}) {
  const { q, limit = 50, cursor, filterNonApp } = opts;
  const nameWhere =
    q && q.trim().length > 0
      ? {
          OR: [
            { name: { contains: q.trim(), mode: "insensitive" as const } },
            {
              normalized_name: {
                contains: q.trim().toLowerCase(),
              },
            },
          ],
        }
      : undefined;
  const nonAppWhere = filterNonApp
    ? { OR: [{ email: null }, { email: "" }] }
    : undefined;
  const where =
    nameWhere && nonAppWhere
      ? { AND: [nameWhere, nonAppWhere] }
      : nameWhere ?? nonAppWhere ?? undefined;

  // Decode the opaque cursor token — no extra DB query needed.
  const cursorPayload = cursor ? decodeCursor(cursor) : undefined;

  const items = await prisma.d_athletes.findMany({
    where,
    take: limit + 1,
    skip: cursorPayload ? 1 : 0,
    cursor: cursorPayload,
    orderBy: [{ name: "asc" }, { athlete_uuid: "asc" }],
    select: athleteListSelect,
  });

  const hasNext = items.length > limit;
  const results = hasNext ? items.slice(0, limit) : items;
  const nextCursor =
    hasNext && results.length > 0
      ? encodeCursor(
          results[results.length - 1].name,
          results[results.length - 1].athlete_uuid
        )
      : null;

  return { items: results, nextCursor };
}

// Cache results for 30 seconds — fine for an internal dashboard.
// Each unique combination of (q, limit, cursor, filterNonApp) is cached separately.
export const getAthletesList = unstable_cache(
  _getAthletesList,
  ["athletes-list"],
  { revalidate: 30 }
);

// A minimal select for the dashboard "recently modified" list.
const recentAthleteSelect = {
  athlete_uuid: true,
  name: true,
  gender: true,
  age_group: true,
  pitching_session_count: true,
  athletic_screen_session_count: true,
  updated_at: true,
} as const;

async function _getRecentAthletes(limit: number) {
  return prisma.d_athletes.findMany({
    orderBy: { updated_at: "desc" },
    take: limit,
    select: recentAthleteSelect,
  });
}

export const getRecentAthletes = unstable_cache(
  _getRecentAthletes,
  ["recent-athletes"],
  { revalidate: 30 }
);
