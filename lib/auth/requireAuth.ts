import { auth, currentUser } from "@clerk/nextjs/server";
import { unauthorized, forbidden } from "@/lib/responses";

/**
 * Throws a 401 response if no Clerk session exists.
 * No-op when CLERK_SECRET_KEY is not configured.
 * Call BEFORE any try/catch block in /api/dashboard/* handlers.
 */
export async function requireAuth(): Promise<void> {
  if (!process.env.CLERK_SECRET_KEY) return;
  const { userId } = await auth();
  if (!userId) {
    throw unauthorized("Authentication required");
  }
}

/**
 * Throws a 401 if not authenticated, 403 if authenticated but wrong role.
 * No-op when CLERK_SECRET_KEY is not configured.
 * Call BEFORE any try/catch block in /api/dashboard/* handlers.
 */
export async function requireRole(role: string): Promise<void> {
  if (!process.env.CLERK_SECRET_KEY) return;
  const { userId } = await auth();
  if (!userId) {
    throw unauthorized("Authentication required");
  }
  const user = await currentUser();
  const userRole = (user?.publicMetadata?.role as string) ?? "user";
  if (userRole !== role) {
    throw forbidden("Insufficient permissions");
  }
}
