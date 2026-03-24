import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/requireAuth";

function isLocalhostUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * Dashboard-only: report whether Octane integration env vars are set.
 * Does not reveal values; use to verify OCTANE_APP_API_URL and OCTANE_API_KEY are loaded.
 * In dev with localhost URL, API key is optional (localDevNoAuth: true).
 * GET /api/dashboard/octane/config-status
 */
export async function GET() {
  await requireRole("admin");
  const url = process.env.OCTANE_APP_API_URL?.trim();
  const hasUrl = Boolean(url);
  const hasKey = Boolean(process.env.OCTANE_API_KEY?.trim());
  const isLocal = hasUrl && isLocalhostUrl(url!);
  const localDevNoAuth = process.env.NODE_ENV === "development" && isLocal;
  const configured = hasUrl && (hasKey || localDevNoAuth);
  const missing: string[] = [];
  if (!hasUrl) missing.push("OCTANE_APP_API_URL");
  if (!hasKey && !localDevNoAuth) missing.push("OCTANE_API_KEY");
  return NextResponse.json({
    configured,
    localDevNoAuth: localDevNoAuth || undefined,
    missing: missing.length > 0 ? missing : undefined,
  });
}
