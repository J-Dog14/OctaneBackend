import { NextRequest } from "next/server";
import { requireApiKey } from "@/lib/auth/requireApiKey";
import { badRequest, internalError, success } from "@/lib/responses";
import { prismaDirect as prisma } from "@/lib/db/prisma-direct";
import { uaisProteusQuerySchema } from "@/lib/validation/uais";

/**
 * GET /api/uais/proteus?athleteUuid=<uuid>
 * 
 * Returns Proteus data filtered by movement type:
 * - Only rows where movement is "Straight Arm Trunk Rotation" OR contains "Shot Put"
 *   (e.g., "Shot Put (Countermovement)")
 * 
 * Returns these fields for each matching row:
 * - peak_power (from power_high)
 * - avg_power (from power_mean)
 * - peak_acceleration (from acceleration_high)
 * 
 * Returns all matching rows (not just the most recent).
 */
export async function GET(request: NextRequest) {
  try {
    requireApiKey(request);

    const { searchParams } = new URL(request.url);
    const rawQuery = {
      athleteUuid: searchParams.get("athleteUuid") ?? undefined,
    };

    const queryValidation = uaisProteusQuerySchema.safeParse(rawQuery);
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

    // Query Proteus data filtered by movement type
    // Match "Straight Arm Trunk Rotation" exactly, or any movement containing "Shot Put"
    const proteusRows = await prisma.f_proteus.findMany({
      where: {
        athlete_uuid: athleteUuid,
        OR: [
          { movement: "Straight Arm Trunk Rotation" },
          { movement: { contains: "Shot Put" } },
        ],
      },
      orderBy: [
        { session_date: "desc" },
        { created_at: "desc" },
      ],
      select: {
        id: true,
        session_date: true,
        movement: true,
        power_high: true,
        power_mean: true,
        acceleration_high: true,
      },
    });

    return success({
      athleteUuid,
      rows: proteusRows.map((row) => ({
        id: row.id,
        sessionDate: row.session_date.toISOString().split("T")[0],
        movement: row.movement,
        peakPower: decimalToNumber(row.power_high),
        avgPower: decimalToNumber(row.power_mean),
        peakAcceleration: decimalToNumber(row.acceleration_high),
      })),
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error("Error in GET /api/uais/proteus:", error);
    return internalError("Failed to fetch Proteus data");
  }
}
