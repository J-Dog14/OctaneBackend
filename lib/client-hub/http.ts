// Auth + error mapping for /api/coach/client-hub/*. Coaches and admins can read and edit the hub;
// it's the only place in the coach suite that writes.
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { requireCoach } from '@/lib/coach/access';
import { HubConflictError, HubNotFoundError, HubNotInstalledError } from './repository';
import { SnapshotMissingError } from './snapshot';
import type { Actor } from './types';

/** The signed-in coach, or a response to send back (401/403). */
export async function requireHubCoach(): Promise<Actor | NextResponse> {
  const denied = await requireCoach();
  if (denied) return denied;
  if (!process.env.CLERK_SECRET_KEY) return { clerkUserId: 'local-dev', name: 'Local dev' };
  const { userId } = await auth();
  const user = await currentUser();
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.username || user?.primaryEmailAddress?.emailAddress || 'Coach';
  return { clerkUserId: userId ?? 'unknown', name };
}

type Handler<C> = (req: Request, ctx: C, actor: Actor) => Promise<Response>;

/** Auth + one place for errors, so handlers stay free of try/catch. */
export function hubRoute<C>(handler: Handler<C>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    const actor = await requireHubCoach();
    if (actor instanceof NextResponse) return actor;
    try {
      return await handler(req, ctx, actor);
    } catch (error) {
      if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map((i) => `${i.path.map(String).join('.') || 'body'}: ${i.message}`).join('; ') }, { status: 400 });
      if (error instanceof HubNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
      if (error instanceof HubConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
      if (error instanceof HubNotInstalledError || error instanceof SnapshotMissingError) {
        return NextResponse.json({ error: error.message, code: error.name }, { status: 503 });
      }
      console.error('[client-hub]', error);
      return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
    }
  };
}

export async function jsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export type IdParams = { params: Promise<{ id: string }> };
export type SubParams = { params: Promise<{ id: string; subId: string }> };
