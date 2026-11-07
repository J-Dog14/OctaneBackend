import { NextResponse } from "next/server";
import { blastRoute, jsonBody, SensorPatchSchema, SensorSchema } from "@/lib/blast/http";
import { saveSensor, setSensorActive } from "@/lib/blast/service";

export const dynamic = "force-dynamic";

/** POST { serial, label } — register a sensor, or rename one (the label is the number the coach uses). */
export const POST = blastRoute(async (req, _ctx, me) => {
  const body = SensorSchema.parse(await jsonBody(req));
  await saveSensor(body.serial, body.label, me);
  return NextResponse.json({ ok: true });
});

/** PATCH { serial, active } — retire a sensor (hidden from the assign screen) or bring it back. */
export const PATCH = blastRoute(async (req) => {
  const body = SensorPatchSchema.parse(await jsonBody(req));
  await setSensorActive(body.serial, body.active);
  return NextResponse.json({ ok: true });
});
