import { NextRequest } from "next/server";
import { requireApiKey } from "@/lib/auth/requireApiKey";
import { badRequest, internalError, success } from "@/lib/responses";
import { prismaDirect as prisma } from "@/lib/db/prisma-direct";
import { uaisAthleticScreenQuerySchema } from "@/lib/validation/uais";

/**
 * GET /api/uais/athletic-screen?athleteUuid=<uuid>
 * 
 * Returns athletic screen data from:
 * - f_athletic_screen_cmj
 * - f_athletic_screen_dj (includes ct and rsi)
 * - f_athletic_screen_ppu
 * - f_athletic_screen_slv
 * 
 * Excludes: f_athletic_screen_nmt
 * 
 * For each table, returns the most recent session (by session_date, then created_at).
 * 
 * Common fields: jh_in, pp_w_per_kg, kurtosis, time_to_rpd_max_s, rpd_max_w_per_s, auc_j
 * DJ-specific fields: ct, rsi
 */
export async function GET(request: NextRequest) {
  try {
    requireApiKey(request);

    const { searchParams } = new URL(request.url);
    const rawQuery = {
      athleteUuid: searchParams.get("athleteUuid") ?? undefined,
    };

    const queryValidation = uaisAthleticScreenQuerySchema.safeParse(rawQuery);
    if (!queryValidation.success) {
      return badRequest(
        queryValidation.error.issues.map((e) => e.message).join(", ")
      );
    }

    const { athleteUuid } = queryValidation.data;

    // Helper to convert Decimal to number
    const decimalToNumber = (value: unknown): number | null => {
      if (value === null || value === undefined) return null;
      if (typeof value === "number") return value;
      if (typeof value === "string") {
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyVal = value as any;
      if (typeof anyVal.toNumber === "function") return anyVal.toNumber();
      if (typeof anyVal.toString === "function") {
        const num = Number(anyVal.toString());
        return Number.isFinite(num) ? num : null;
      }
      return null;
    };

    // Query each table for the most recent session
    const [cmj, dj, ppu, slv] = await Promise.all([
      // CMJ
      prisma.f_athletic_screen_cmj.findFirst({
        where: { athlete_uuid: athleteUuid },
        orderBy: [{ session_date: "desc" }, { created_at: "desc" }],
        select: {
          session_date: true,
          jh_in: true,
          pp_w_per_kg: true,
          kurtosis: true,
          time_to_rpd_max_s: true,
          rpd_max_w_per_s: true,
          auc_j: true,
        },
      }),
      // DJ (includes ct and rsi)
      prisma.f_athletic_screen_dj.findFirst({
        where: { athlete_uuid: athleteUuid },
        orderBy: [{ session_date: "desc" }, { created_at: "desc" }],
        select: {
          session_date: true,
          jh_in: true,
          pp_w_per_kg: true,
          kurtosis: true,
          time_to_rpd_max_s: true,
          rpd_max_w_per_s: true,
          auc_j: true,
          ct: true,
          rsi: true,
        },
      }),
      // PPU
      prisma.f_athletic_screen_ppu.findFirst({
        where: { athlete_uuid: athleteUuid },
        orderBy: [{ session_date: "desc" }, { created_at: "desc" }],
        select: {
          session_date: true,
          jh_in: true,
          pp_w_per_kg: true,
          kurtosis: true,
          time_to_rpd_max_s: true,
          rpd_max_w_per_s: true,
          auc_j: true,
        },
      }),
      // SLV
      prisma.f_athletic_screen_slv.findFirst({
        where: { athlete_uuid: athleteUuid },
        orderBy: [{ session_date: "desc" }, { created_at: "desc" }],
        select: {
          session_date: true,
          jh_in: true,
          pp_w_per_kg: true,
          kurtosis: true,
          time_to_rpd_max_s: true,
          rpd_max_w_per_s: true,
          auc_j: true,
        },
      }),
    ]);

    return success({
      athleteUuid,
      cmj: cmj
        ? {
            sessionDate: cmj.session_date.toISOString().split("T")[0],
            jhIn: decimalToNumber(cmj.jh_in),
            ppWPerKg: decimalToNumber(cmj.pp_w_per_kg),
            kurtosis: decimalToNumber(cmj.kurtosis),
            timeToRpdMaxS: decimalToNumber(cmj.time_to_rpd_max_s),
            rpdMaxWPerS: decimalToNumber(cmj.rpd_max_w_per_s),
            aucJ: decimalToNumber(cmj.auc_j),
          }
        : null,
      dj: dj
        ? {
            sessionDate: dj.session_date.toISOString().split("T")[0],
            jhIn: decimalToNumber(dj.jh_in),
            ppWPerKg: decimalToNumber(dj.pp_w_per_kg),
            kurtosis: decimalToNumber(dj.kurtosis),
            timeToRpdMaxS: decimalToNumber(dj.time_to_rpd_max_s),
            rpdMaxWPerS: decimalToNumber(dj.rpd_max_w_per_s),
            aucJ: decimalToNumber(dj.auc_j),
            ct: decimalToNumber(dj.ct),
            rsi: decimalToNumber(dj.rsi),
          }
        : null,
      ppu: ppu
        ? {
            sessionDate: ppu.session_date.toISOString().split("T")[0],
            jhIn: decimalToNumber(ppu.jh_in),
            ppWPerKg: decimalToNumber(ppu.pp_w_per_kg),
            kurtosis: decimalToNumber(ppu.kurtosis),
            timeToRpdMaxS: decimalToNumber(ppu.time_to_rpd_max_s),
            rpdMaxWPerS: decimalToNumber(ppu.rpd_max_w_per_s),
            aucJ: decimalToNumber(ppu.auc_j),
          }
        : null,
      slv: slv
        ? {
            sessionDate: slv.session_date.toISOString().split("T")[0],
            jhIn: decimalToNumber(slv.jh_in),
            ppWPerKg: decimalToNumber(slv.pp_w_per_kg),
            kurtosis: decimalToNumber(slv.kurtosis),
            timeToRpdMaxS: decimalToNumber(slv.time_to_rpd_max_s),
            rpdMaxWPerS: decimalToNumber(slv.rpd_max_w_per_s),
            aucJ: decimalToNumber(slv.auc_j),
          }
        : null,
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error("Error in GET /api/uais/athletic-screen:", error);
    return internalError("Failed to fetch athletic screen data");
  }
}
