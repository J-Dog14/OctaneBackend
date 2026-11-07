// Auth, origin check, validation and error mapping for /api/coach/blast/*.
// Coaches and admins can assign sensors and add athletes (never delete them).
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { requireHubCoach } from "@/lib/client-hub/http";
import { sameOrigin } from "@/lib/videos/http";
import { BlastError, BlastNotInstalledError, type Actor } from "./service";

type Handler<C> = (req: Request, ctx: C, actor: Actor) => Promise<Response>;

export function blastRoute<C>(handler: Handler<C>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    const actor = await requireHubCoach();
    if (actor instanceof NextResponse) return actor;
    if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) {
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    }
    try {
      return await handler(req, ctx, actor);
    } catch (error) {
      if (error instanceof ZodError) {
        return NextResponse.json({ error: error.issues.map((i) => `${i.path.map(String).join(".") || "body"}: ${i.message}`).join("; ") }, { status: 400 });
      }
      if (error instanceof BlastError) return NextResponse.json({ error: error.message, ...error.extra }, { status: error.status });
      if (error instanceof BlastNotInstalledError) return NextResponse.json({ error: error.message, code: error.name }, { status: 503 });
      console.error("[blast]", error);
      return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
  };
}

export async function jsonBody(req: Request, maxBytes = 8_000): Promise<unknown> {
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new BlastError(413, "Request too large");
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new BlastError(400, "Invalid JSON");
  }
}

export const noStore = { "Cache-Control": "private, no-store" } as const;
export type IdParams = { params: Promise<{ id: string }> };

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const athleteUuid = z.string().regex(/^[A-Za-z0-9-]{1,64}$/, "Invalid athlete");
const serial = z.string().trim().regex(/^[0-9A-Za-z-]{4,32}$/, "Serial is 4-32 letters/digits");
const optText = (max: number) => z.string().trim().max(max).transform((s) => s || null).nullable().optional().transform((v) => v ?? null);
const isDay = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && d.getUTCFullYear() >= 1940 && d <= new Date();
};

export const IdSchema = z.coerce.number().int().positive();

export const AssignSchema = z.object({ sensorSerial: serial, athleteUuid, note: optText(500) }).strict();

export const AssignmentPatchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("end") }).strict(),
  z.object({ action: z.literal("void") }).strict(),
  z.object({ action: z.literal("change_athlete"), athleteUuid }).strict(),
]);

export const SensorSchema = z.object({ serial, label: z.string().trim().min(1).max(20) }).strict();
export const SensorPatchSchema = z.object({ serial, active: z.boolean() }).strict();

const name = z.string().trim().min(1, "Required").max(60).regex(/^[\p{L}\p{M}' .-]+$/u, "Letters, spaces, ' . - only");
export const NewAthleteSchema = z
  .object({
    firstName: name,
    lastName: name,
    dateOfBirth: z.string().trim().refine((s) => s === "" || isDay(s), "Use a real date (YYYY-MM-DD)").optional().nullable()
      .transform((s) => s || null),
    email: z.string().trim().max(200).refine((s) => s === "" || z.string().email().safeParse(s).success, "Invalid email")
      .optional().nullable().transform((s) => s || null),
    force: z.boolean().default(false),
  })
  .strict();
