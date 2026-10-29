import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { createAsyncTtlCache } from "@/lib/cache/asyncTtlCache";
import type { ComparisonScope } from "./comparison";
import type { DomainId } from "@/lib/athlete-tracking/types";

// Use real sessions, not data flags: the pitching flag means 3D captures and
// does not establish whether an athlete has Savant/Trackman pitch data.
const DOMAIN_TABLES: Record<DomainId, string[]> = {
  pitching: ["public.f_pitching_trials", "public.f_kinematics_pitching"],
  hitting: ["public.f_kinematics_hitting"],
  armAction: ["public.f_arm_action"],
  athleticScreen: ["public.v_athletic_screen_cmj", "public.v_athletic_screen_dj", "public.v_athletic_screen_ppu", "public.v_athletic_screen_slv"],
  mobility: ["public.f_mobility"], proteus: ["public.f_proteus"],
};
const PITCH_TABLES = ["pitch_intel.savant_pitches", "pitch_intel.trackman_pitches", "pitch_intel.aggregate_reports"];
const availability = createAsyncTtlCache({ ttlMs: 60_000, maxEntries: 1, maxBytes: 1024 });

export async function athleteDataFilter(scope: ComparisonScope, domain?: DomainId): Promise<Prisma.Sql> {
  let tables: string[];
  if (domain) tables = DOMAIN_TABLES[domain];
  else switch (scope) {
    case "pitching": {
      // Savant/Trackman tables are optional on fresh warehouses.
      tables = await availability.getOrLoad("pitch-tables", async () => {
        const rows = await prisma.$queryRaw<Array<{ name: string }>>`
          SELECT name FROM unnest(${PITCH_TABLES}::text[]) name WHERE to_regclass(name) IS NOT NULL
        `;
        return rows.map((r) => r.name);
      });
      break;
    }
    case "biomechanics": tables = [...DOMAIN_TABLES.pitching, ...DOMAIN_TABLES.armAction]; break;
    case "hitting": tables = DOMAIN_TABLES.hitting; break;
    case "assessments": tables = DOMAIN_TABLES.athleticScreen; break;
    case "mobility": tables = DOMAIN_TABLES.mobility; break;
    case "proteus": tables = DOMAIN_TABLES.proteus; break;
    case "prosup": tables = ["public.f_pro_sup"]; break;
    case "curveball": tables = ["public.f_curveball_test"]; break;
    case "readiness": tables = ["public.v_readiness_screen_sessions"]; break;
    default: return Prisma.sql`TRUE`;
  }
  if (!tables.length) return Prisma.sql`FALSE`;
  // Identifiers come exclusively from the static allowlists above.
  return Prisma.sql`(${Prisma.join(tables.map((table) => Prisma.sql`EXISTS (
    SELECT 1 FROM ${Prisma.raw(table)} f WHERE f.athlete_uuid = a.athlete_uuid
  )`), " OR ")})`;
}
