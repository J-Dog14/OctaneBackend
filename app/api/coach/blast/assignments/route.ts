import { NextResponse } from "next/server";
import { AssignSchema, blastRoute, jsonBody } from "@/lib/blast/http";
import { assignSensor } from "@/lib/blast/service";

export const dynamic = "force-dynamic";

/** POST { sensorSerial, athleteUuid, note? } — "this sensor is now on this athlete". */
export const POST = blastRoute(async (req, _ctx, me) => {
  const body = AssignSchema.parse(await jsonBody(req));
  return NextResponse.json(await assignSensor(body.sensorSerial, body.athleteUuid, body.note, me));
});
