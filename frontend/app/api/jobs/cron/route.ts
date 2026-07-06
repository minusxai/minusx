/**
 * POST /api/jobs/cron
 * Called by an external cron on a per-minute schedule.
 * Delegates the actual scan to `runForOrg` (`lib/jobs/cron-scan.ts`).
 *
 * External trigger options:
 *   - Vercel Cron Jobs (vercel.json)
 *   - Railway cron
 *   - Any scheduler that can POST to this endpoint
 */
import { NextRequest } from 'next/server';
import { withCronAuth } from '@/lib/http/with-auth';
import { successResponse, handleApiError } from '@/lib/http/api-responses';
import { JobRunsDB } from '@/lib/database/job-runs-db';
import { runForOrg } from '@/lib/jobs/cron-scan';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withCronAuth(async (_request: NextRequest) => {
  try {
    await JobRunsDB.ensureTable();
    const result = await runForOrg(new Date());
    return successResponse({ results: { 0: result } });
  } catch (error) {
    return handleApiError(error);
  }
});
