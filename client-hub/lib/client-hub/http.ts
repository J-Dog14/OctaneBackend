// Auth + error mapping for the Client Hub routes (all under /api/dashboard → Clerk).
// If lib/auth/requireAuth.ts already returns the Clerk user, call it inside requireStaff instead.
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { OctaneRequestError } from './octane/source';
import { HubNotFoundError, resolveStaffUser } from './service';
import type { StaffUser } from './types';

class UnauthorizedError extends Error {}

export async function requireStaff(): Promise<StaffUser> {
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError();
  const user = await currentUser();
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.username || 'Staff';
  return resolveStaffUser(userId, name);
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Single chokepoint for errors, so handlers stay free of try/catch. */
export function hubRoute<C>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (error) {
      if (error instanceof UnauthorizedError) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      if (error instanceof ZodError) return NextResponse.json({ error: 'Invalid request', issues: error.issues }, { status: 400 });
      if (error instanceof HubNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
      if (isPrismaNotFound(error)) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
      if (error instanceof OctaneRequestError) return NextResponse.json({ error: error.message }, { status: 502 });
      console.error('[client-hub]', error);
      return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
    }
  };
}

/** P2025 = record to update/delete missing; P2003 = note for a client that doesn't exist. */
function isPrismaNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error.code === 'P2025' || error.code === 'P2003');
}

export type IdParams = { params: Promise<{ id: string }> };
export type NoteParams = { params: Promise<{ id: string; noteId: string }> };
