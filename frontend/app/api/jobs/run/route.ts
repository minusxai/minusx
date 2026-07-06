/**
 * POST /api/jobs/run
 * Trigger a job execution (manual or forced).
 * Parses the request and delegates orchestration to `runJob`
 * (`lib/jobs/run-job.ts`), which dispatches to registered job handlers via
 * JOB_HANDLERS and delivers any resulting messages via `deliverMessages`.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { successResponse, ApiErrors, handleApiError } from '@/lib/http/api-responses';
import { runJob } from '@/lib/jobs/run-job';
import type { TransformRunMode } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body = await request.json();
    const { job_id, job_type, force = false, send = true, run_mode } = body as {
      job_id: string;
      job_type: string;
      force?: boolean;
      send?: boolean;
      run_mode?: TransformRunMode;
    };

    if (!job_id || !job_type) {
      return ApiErrors.badRequest('job_id and job_type are required');
    }

    const outcome = await runJob({ jobId: job_id, jobType: job_type, force, send, runMode: run_mode }, user);

    switch (outcome.kind) {
      case 'unsupported_job_type':
        return ApiErrors.badRequest(`Unsupported job_type: ${job_type}`);
      case 'invalid_job_id':
        return ApiErrors.badRequest('job_id must be a numeric file ID');
      case 'not_found':
        return ApiErrors.notFound('Job file');
      case 'already_running':
        return successResponse({ runId: outcome.runId, fileId: outcome.fileId, status: 'already_running' });
      case 'completed':
        return successResponse({ runId: outcome.runId, fileId: outcome.fileId, status: outcome.status });
    }
  } catch (error) {
    return handleApiError(error);
  }
});
