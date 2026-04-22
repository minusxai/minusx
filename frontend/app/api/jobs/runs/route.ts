/**
 * GET /api/jobs/runs
 * Fetch job run history for a specific job.
 *
 * Query params:
 *   job_id   - file ID of the triggering entity (required)
 *   job_type - e.g. 'alert' (required)
 *   limit    - max results to return (default: 20)
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { successResponse, ApiErrors, handleApiError } from '@/lib/api/api-responses';
import { JobRunsDB } from '@/lib/database/job-runs-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = withAuth(async (request: NextRequest, user) => {
  try {
    const { searchParams } = new URL(request.url);
    const job_id = searchParams.get('job_id');
    const job_type = searchParams.get('job_type');
    const limitStr = searchParams.get('limit');
    const limit = limitStr ? parseInt(limitStr, 10) : 20;

    if (!job_id || !job_type) {
      return ApiErrors.badRequest('job_id and job_type query params are required');
    }

    await JobRunsDB.ensureTable();

    const runs = await JobRunsDB.getByJobId(job_id, job_type, limit);
    return successResponse(runs);
  } catch (error) {
    return handleApiError(error);
  }
});
