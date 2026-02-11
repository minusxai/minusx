import { NextResponse } from 'next/server';

/**
 * Health check endpoint
 * Used by database initialization scripts to detect if the Next.js app is running
 */
export async function GET() {
  return NextResponse.json({ status: 'ok' });
}
