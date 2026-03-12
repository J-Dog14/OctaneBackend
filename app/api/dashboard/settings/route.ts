import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

/**
 * GET /api/dashboard/settings
 * Returns all org settings as a key/value object.
 */
export async function GET() {
  const rows = await prisma.orgSetting.findMany();
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return NextResponse.json({ settings });
}

/**
 * PATCH /api/dashboard/settings
 * Upserts one or more settings. Body: { settings: Record<string, string> }
 * Pass an empty string to clear a setting (it will be deleted).
 */
export async function PATCH(request: NextRequest) {
  const body = await request.json() as { settings?: Record<string, string> };
  const incoming = body?.settings;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return NextResponse.json({ error: "Body must be { settings: Record<string, string> }" }, { status: 400 });
  }

  const upserts: Promise<unknown>[] = [];
  for (const [key, value] of Object.entries(incoming)) {
    if (typeof key !== "string" || key.trim() === "") continue;
    if (value === "" || value === null || value === undefined) {
      // Empty string = delete the setting
      upserts.push(prisma.orgSetting.deleteMany({ where: { key } }));
    } else {
      upserts.push(
        prisma.orgSetting.upsert({
          where: { key },
          create: { key, value: String(value) },
          update: { value: String(value) },
        })
      );
    }
  }

  await Promise.all(upserts);

  const rows = await prisma.orgSetting.findMany();
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return NextResponse.json({ settings });
}
