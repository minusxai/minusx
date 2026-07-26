import { NextResponse } from 'next/server';

/**
 * Health check endpoint — unauthenticated liveness probe (allowlisted in middleware)
 * for external deploy/uptime checks. Nothing in this repo calls it.
 */
export async function GET() {
  return NextResponse.json({ status: 'ok' });
}
