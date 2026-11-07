import { NextResponse } from "next/server";
import { AssignmentPatchSchema, blastRoute, IdSchema, jsonBody, type IdParams } from "@/lib/blast/http";
import { updateAssignment } from "@/lib/blast/service";

export const dynamic = "force-dynamic";

/** PATCH { action: "end" | "void" } or { action: "change_athlete", athleteUuid }. */
export const PATCH = blastRoute<IdParams>(async (req, { params }, me) => {
  const id = IdSchema.parse((await params).id);
  const body = AssignmentPatchSchema.parse(await jsonBody(req));
  return NextResponse.json(await updateAssignment(id, body, me));
});
