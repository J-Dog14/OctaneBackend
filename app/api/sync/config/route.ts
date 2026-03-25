import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

/**
 * GET /api/sync/config
 * Called by the OctaneSync agent on startup.
 * Returns R2 credentials + per-runner data directory paths so the agent
 * needs zero local configuration beyond the Railway URL + agent token.
 * Auth: Authorization: Bearer <agent_token>
 */
export async function GET(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.orgSetting.findMany();
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  if (!s.agent_token || s.agent_token !== token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Update last-seen so agent-status endpoint knows the agent is online
  await prisma.orgSetting.upsert({
    where: { key: "agent_last_seen" },
    create: { key: "agent_last_seen", value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  });

  return NextResponse.json({
    r2: {
      account_id: s.r2_account_id ?? "",
      access_key_id: s.r2_access_key_id ?? "",
      secret_access_key: s.r2_secret_access_key ?? "",
      bucket_name: s.r2_bucket_name ?? "",
    },
    runner_paths: {
      "athletic-screen": s.uais_data_dir_athletic_screen ?? "",
      "readiness-screen": s.uais_data_dir_readiness_screen ?? "",
      "pro-sup": s.uais_data_dir_pro_sup ?? "",
      "arm-action": s.uais_data_dir_arm_action ?? "",
      pitching: s.uais_data_dir_pitching ?? "",
      hitting: s.uais_data_dir_hitting ?? "",
      curveball: s.uais_data_dir_curveball ?? "",
      mobility: s.uais_data_dir_mobility ?? "",
      proteus: s.uais_data_dir_proteus ?? "",
    },
  });
}
