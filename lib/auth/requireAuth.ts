import { auth } from "@clerk/nextjs/server";
import { unauthorized } from "@/lib/responses";

/**
 * Throws a 401 response if no Clerk session exists.
 * No-op when CLERK_SECRET_KEY is not configured (allows unauthenticated access
 * during development or before Clerk is set up).
 * Call BEFORE any try/catch block in /api/dashboard/* handlers.
 */
export async function requireAuth(): Promise<void> {
  if (!process.env.CLERK_SECRET_KEY) return;
  const { userId } = await auth();
  if (!userId) {
    throw unauthorized("Authentication required");
  }
}
