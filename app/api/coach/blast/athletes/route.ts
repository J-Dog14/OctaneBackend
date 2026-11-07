import { NextResponse } from "next/server";
import { blastRoute, jsonBody, NewAthleteSchema, noStore } from "@/lib/blast/http";
import { createAthlete, searchAthletes } from "@/lib/blast/service";

export const dynamic = "force-dynamic";

/** GET ?q= — every warehouse athlete, hitters first. No q = athletes on a sensor in the last 30 days. */
export const GET = blastRoute(async (req) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 80);
  return NextResponse.json({ athletes: await searchAthletes(q) }, { headers: noStore });
});

/** POST { firstName, lastName, dateOfBirth?, email?, force? } — add a player who isn't in the database. */
export const POST = blastRoute(async (req, _ctx, me) => {
  const body = NewAthleteSchema.parse(await jsonBody(req));
  return NextResponse.json(await createAthlete(body, me), { status: 201 });
});
