// Auth, origin check and error mapping for /api/coach/videos/*. Coaches and admins can read,
// upload, edit and delete videos (never athletes).
import { NextResponse } from "next/server";
import { requireHubCoach } from "@/lib/client-hub/http";
import { VideoError, VideosNotInstalledError, type Actor } from "./service";

/**
 * Writes must come from this app's own pages (CSRF guard on top of Clerk's SameSite cookies).
 * Compares the Origin header with the host the request was sent to (Railway sets x-forwarded-host).
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim() || req.headers.get("host") || new URL(req.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

type Handler<C> = (req: Request, ctx: C, actor: Actor) => Promise<Response>;

export function videoRoute<C>(handler: Handler<C>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    const actor = await requireHubCoach();
    if (actor instanceof NextResponse) return actor;
    if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) {
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    }
    try {
      return await handler(req, ctx, actor);
    } catch (error) {
      if (error instanceof VideoError) return NextResponse.json({ error: error.message, code: error.code, ...error.extra }, { status: error.status });
      if (error instanceof VideosNotInstalledError) return NextResponse.json({ error: error.message, code: error.name }, { status: 503 });
      const msg = String((error as Error)?.message ?? error);
      if (msg.includes("R2 not configured") || msg.includes("Bucket Name not configured")) return NextResponse.json({ error: msg }, { status: 503 });
      console.error("[videos]", error);
      return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
  };
}

export async function jsonBody(req: Request, maxBytes = 16_000): Promise<unknown> {
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new VideoError(413, "Request too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new VideoError(400, "Invalid JSON");
  }
}

export const noStore = { "Cache-Control": "private, no-store" } as const;
export type IdParams = { params: Promise<{ id: string }> };
