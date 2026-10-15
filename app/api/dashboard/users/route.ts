import { auth, clerkClient } from "@clerk/nextjs/server";
import { checkRoles } from "@/lib/auth/requireAuth";
import { ROLES, type Role } from "@/lib/auth/role";
import { badRequest, internalError, success } from "@/lib/responses";

/**
 * Admin user management. Roles live in Clerk publicMetadata.role
 * ("coach" | "admin"; missing = "user", i.e. regular staff).
 */

export async function GET() {
  const denied = await checkRoles(["admin"]);
  if (denied) return denied;
  if (!process.env.CLERK_SECRET_KEY) return success({ users: [] });
  try {
    const client = await clerkClient();
    const { data } = await client.users.getUserList({ limit: 500, orderBy: "-last_sign_in_at" });
    const users = data.map((u) => ({
      id: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || null,
      email: u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? null,
      role: (ROLES.includes(u.publicMetadata?.role as Role) ? u.publicMetadata.role : "user") as Role,
      lastSignInAt: u.lastSignInAt,
      createdAt: u.createdAt,
    }));
    return success({ users });
  } catch (err) {
    console.error("[users] list failed", err);
    return internalError("Failed to load users from Clerk");
  }
}

export async function PATCH(request: Request) {
  const denied = await checkRoles(["admin"]);
  if (denied) return denied;
  if (!process.env.CLERK_SECRET_KEY) return badRequest("Clerk is not configured");

  const body = await request.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId : null;
  const role = body?.role as Role;
  if (!userId || !ROLES.includes(role)) return badRequest("userId and a valid role are required");

  const { userId: me } = await auth();
  if (userId === me && role !== "admin") {
    return badRequest("You can't remove your own admin role");
  }

  try {
    const client = await clerkClient();
    // null deletes the key, so "user" leaves no role behind.
    await client.users.updateUserMetadata(userId, { publicMetadata: { role: role === "user" ? null : role } });
    return success({ userId, role });
  } catch (err) {
    console.error("[users] role update failed", err);
    return internalError("Failed to update role in Clerk");
  }
}
