import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/api/health(.*)",
  "/api/uais(.*)",
  "/api/octane(.*)",
  "/api/biomech(.*)",
  "/api/external(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  // No-op when Clerk is not configured (dev / pre-Clerk setup).
  if (!process.env.CLERK_SECRET_KEY) return;
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
