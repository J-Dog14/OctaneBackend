import { NextRequest, NextResponse } from "next/server";
import { badRequest, notFound, success, unauthorized } from "@/lib/responses";
import { lookupOctaneUserByEmail } from "@/lib/octane/octaneUserLookup";
import { requireAuth } from "@/lib/auth/requireAuth";

/** Basic email format: non-empty, has @, and something before/after. */
function isValidEmailFormat(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const at = trimmed.indexOf("@");
  return at > 0 && at < trimmed.length - 1;
}

/**
 * Dashboard-only: look up an Octane app user by email.
 * Proxies to the Octane API with server-side API key; no key exposed to client.
 * GET /api/dashboard/octane/users/by-email?email=...
 */
export async function GET(request: NextRequest) {
  await requireAuth();
  const emailParam = request.nextUrl.searchParams.get("email");
  if (emailParam === null || emailParam === "") {
    return badRequest("Email query parameter is required");
  }
  const email = emailParam.trim();
  if (!isValidEmailFormat(email)) {
    return badRequest("Invalid email format");
  }

  const result = await lookupOctaneUserByEmail(email);

  if (result.ok) {
    return success(result.user);
  }

  switch (result.status) {
    case 401:
      return unauthorized(result.error);
    case 400:
      return badRequest(result.error);
    case 404:
      return notFound(result.error);
    case 503:
      return NextResponse.json({ error: result.error }, { status: 503 });
    case 502:
    case 500:
    default:
      return NextResponse.json(
        { error: result.error || "Failed to reach Octane API" },
        { status: result.status }
      );
  }
}
