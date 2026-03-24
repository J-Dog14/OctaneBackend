import { NextResponse } from "next/server";

export function unauthorized(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function forbidden(message: string = "Insufficient permissions"): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function notFound(message: string = "Resource not found"): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function internalError(message: string = "Internal server error"): NextResponse {
  return NextResponse.json({ error: message }, { status: 500 });
}

export function success<T>(data: T, status: number = 200): NextResponse {
  return NextResponse.json(data, { status });
}

