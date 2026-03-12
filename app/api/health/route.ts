import { NextRequest } from "next/server";
import { success } from "@/lib/responses";

/**
 * GET /api/health
 * Public health check endpoint (no authentication required).
 */
export async function GET(_request: NextRequest) {
  return success({ ok: true });
}

