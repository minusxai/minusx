import { NextResponse } from 'next/server';

/**
 * GET /api/health — public liveness probe (JSON, no auth; whitelisted in create-middleware.ts).
 * Used by database initialization scripts to detect if the Next.js app is running, and by
 * deploy/ops checks on hosts without SSH access (uptime + process RSS). Liveness only — no DB
 * round-trips, so a slow data plane can't flap the probe.
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    uptime_s: Math.round(process.uptime()),
    rss_mb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
  });
}
