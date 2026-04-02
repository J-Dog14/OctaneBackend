import { NextRequest } from "next/server";
import { requireApiKey } from "@/lib/auth/requireApiKey";
import { badRequest, internalError, success } from "@/lib/responses";
import { prismaDirect as prisma } from "@/lib/db/prisma-direct";
import { uaisHittingQuerySchema } from "@/lib/validation/uais";

/**
 * GET /api/uais/hitting?athleteUuid=<uuid>
 * 
 * Returns hitting kinematics data for the most recent session.
 * 
 * Returns these metrics (most with _MEAN suffix):
 * - Max_Pelvis_Ang_Vel_MEAN
 * - Max_Thorax_Ang_Vel_MEAN
 * - Max_Lead_Forearm_Ang_Vel_MEAN
 * - Max_Bat_Ang_Vel_MEAN
 * - Pelvis_Shoulders_Separation@Downswing_MEAN
 * - Pelvis_Shoulders_Separation@Lead_Foot_Down_MEAN
 * - Trunk_Angle@Setup (no _MEAN suffix)
 * - Trunk_Angle@Lead_Foot_Down_MEAN
 */
export async function GET(request: NextRequest) {
  try {
    requireApiKey(request);

    const { searchParams } = new URL(request.url);
    const rawQuery = {
      athleteUuid: searchParams.get("athleteUuid") ?? undefined,
    };

    const queryValidation = uaisHittingQuerySchema.safeParse(rawQuery);
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

    // Find the most recent session for this athlete
    const mostRecentSession = await prisma.f_kinematics_hitting.findFirst({
      where: { athlete_uuid: athleteUuid },
      orderBy: { session_date: "desc" },
      select: { session_date: true },
    });

    if (!mostRecentSession) {
      return success({
        athleteUuid,
        sessionDate: null,
        metrics: null,
      });
    }

    const sessionDate = mostRecentSession.session_date;

    // Define the metric names we need
    // Most have _MEAN suffix, but Trunk_Angle@Setup does not
    const metricNames = [
      "PROCESSED.Max_Pelvis_Ang_Vel_MEAN",
      "PROCESSED.Max_Thorax_Ang_Vel_MEAN",
      "PROCESSED.Max_Lead_Forearm_Ang_Vel_MEAN",
      "PROCESSED.Max_Bat_Ang_Vel_MEAN",
      "PROCESSED.Pelvis_Shoulders_Separation@Downswing_MEAN",
      "PROCESSED.Pelvis_Shoulders_Separation@Lead_Foot_Down_MEAN",
      "PROCESSED.Trunk_Angle@Setup",
      "PROCESSED.Trunk_Angle@Lead_Foot_Down_MEAN",
    ];

    // Query all metrics for the most recent session
    const rows = await prisma.f_kinematics_hitting.findMany({
      where: {
        athlete_uuid: athleteUuid,
        session_date: sessionDate,
        metric_name: { in: metricNames },
      },
      select: {
        metric_name: true,
        value: true,
      },
    });

    // Build a map of metric_name -> value
    const valueByMetricName = new Map<string, number | null>();
    for (const row of rows) {
      // For time-series data, we might have multiple frames per metric
      // Take the first non-null value we find (or we could take max/min if needed)
      if (!valueByMetricName.has(row.metric_name)) {
        valueByMetricName.set(row.metric_name, decimalToNumber(row.value));
      }
    }

    return success({
      athleteUuid,
      sessionDate: sessionDate.toISOString().split("T")[0],
      metrics: {
        maxPelvisAngVel: valueByMetricName.get(
          "PROCESSED.Max_Pelvis_Ang_Vel_MEAN"
        ) ?? null,
        maxThoraxAngVel: valueByMetricName.get(
          "PROCESSED.Max_Thorax_Ang_Vel_MEAN"
        ) ?? null,
        maxLeadForearmAngVel: valueByMetricName.get(
          "PROCESSED.Max_Lead_Forearm_Ang_Vel_MEAN"
        ) ?? null,
        maxBatAngVel: valueByMetricName.get(
          "PROCESSED.Max_Bat_Ang_Vel_MEAN"
        ) ?? null,
        pelvisShouldersSeparationAtDownswing: valueByMetricName.get(
          "PROCESSED.Pelvis_Shoulders_Separation@Downswing_MEAN"
        ) ?? null,
        pelvisShouldersSeparationAtFootContact: valueByMetricName.get(
          "PROCESSED.Pelvis_Shoulders_Separation@Lead_Foot_Down_MEAN"
        ) ?? null,
        trunkAngleAtSetup: valueByMetricName.get(
          "PROCESSED.Trunk_Angle@Setup"
        ) ?? null,
        trunkAngleAtFootContact: valueByMetricName.get(
          "PROCESSED.Trunk_Angle@Lead_Foot_Down_MEAN"
        ) ?? null,
      },
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error("Error in GET /api/uais/hitting:", error);
    return internalError("Failed to fetch hitting data");
  }
}
