import { NextRequest } from "next/server";
import { badRequest, internalError, success } from "@/lib/responses";
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/requireAuth";

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * GET /api/dashboard/athletes/check-duplicates?name=...&email=...
 * Returns possible existing athletes matching name and/or email (for New Athlete pre-check).
 * At least one of name or email must be provided.
 */
export async function GET(request: NextRequest) {
  await requireAuth();
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get("name")?.trim();
    const emailRaw = searchParams.get("email")?.trim();
    const email = emailRaw ? normalizeEmail(emailRaw) : undefined;

    if (!name && !email) {
      return badRequest("Provide at least one of name or email.");
    }

    const conditions: Prisma.d_athletesWhereInput[] = [];

    if (name && name.length > 0) {
      conditions.push({
        OR: [
          { name: { contains: name, mode: "insensitive" } },
          { normalized_name: { contains: name.toLowerCase() } },
        ],
      });
    }

    if (email) {
      conditions.push({ email: { equals: email } });
    }

    const where: Prisma.d_athletesWhereInput =
      conditions.length === 1 ? conditions[0]! : { AND: conditions };

    const items = await prisma.d_athletes.findMany({
      where,
      take: 10,
      orderBy: [{ name: "asc" }],
      select: {
        athlete_uuid: true,
        name: true,
        email: true,
      },
    });

    return success({
      matches: items.map((a) => ({
        athlete_uuid: a.athlete_uuid,
        name: a.name,
        email: a.email ?? null,
      })),
    });
  } catch (error) {
    console.error("Error in GET /api/dashboard/athletes/check-duplicates:", error);
    return internalError("Failed to check for duplicates");
  }
}
