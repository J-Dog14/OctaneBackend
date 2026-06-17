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

export type RecentAthlete = {
  athlete_uuid: string;
  name: string;
  gender: string | null;
  age_group: string | null;
  pitching_session_count: number;
  athletic_screen_session_count: number;
  last_data_at: Date;
};

async function _getRecentAthletes(limit: number): Promise<RecentAthlete[]> {
  return prisma.$queryRaw<RecentAthlete[]>`
    SELECT
      a.athlete_uuid,
      a.name,
      a.gender,
      a.age_group,
      a.pitching_session_count,
      a.athletic_screen_session_count,
      COALESCE(MAX(f.latest_insert), a.created_at) AS last_data_at
    FROM analytics.d_athletes a
    LEFT JOIN (
      SELECT athlete_uuid, MAX(created_at) AS latest_insert FROM public.f_pitching_trials    GROUP BY athlete_uuid UNION ALL
      SELECT athlete_uuid, MAX(created_at) AS latest_insert FROM public.f_athletic_screen     GROUP BY athlete_uuid UNION ALL
      SELECT athlete_uuid, MAX(created_at) AS latest_insert FROM public.f_readiness_screen    GROUP BY athlete_uuid UNION ALL
      SELECT athlete_uuid, MAX(created_at) AS latest_insert FROM public.f_mobility            GROUP BY athlete_uuid UNION ALL
      SELECT athlete_uuid, MAX(created_at) AS latest_insert FROM public.f_proteus             GROUP BY athlete_uuid UNION ALL
      SELECT athlete_uuid, MAX(created_at) AS latest_insert FROM public.f_arm_action          GROUP BY athlete_uuid UNION ALL
      SELECT athlete_uuid, MAX(created_at) AS latest_insert FROM public.f_hitting_trials      GROUP BY athlete_uuid
    ) f ON f.athlete_uuid = a.athlete_uuid
    GROUP BY
      a.athlete_uuid, a.name, a.gender, a.age_group,
      a.pitching_session_count, a.athletic_screen_session_count, a.created_at
    ORDER BY last_data_at DESC
    LIMIT ${limit}
  `;
}

export const getRecentAthletes = unstable_cache(
  _getRecentAthletes,
  ["recent-athletes"],
  { revalidate: 30 }
);
