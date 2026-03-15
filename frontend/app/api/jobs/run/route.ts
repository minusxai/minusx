/**
 * POST /api/jobs/run
 * Trigger a job execution (manual or forced).
 * Dispatches to registered job handlers via JOB_HANDLERS.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { successResponse, ApiErrors, handleApiError } from '@/lib/api/api-responses';
import { JobRunsDB } from '@/lib/database/job-runs-db';
import { FilesAPI } from '@/lib/data/files.server';
import { resolvePath } from '@/lib/mode/path-resolver';
import { JOB_HANDLERS } from '@/lib/jobs/job-registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body = await request.json();
    const { job_id, job_type } = body as { job_id: string; job_type: string };

    if (!job_id || !job_type) {
      return ApiErrors.badRequest('job_id and job_type are required');
    }

    const handler = JOB_HANDLERS[job_type];
    if (!handler) {
      return ApiErrors.badRequest(`Unsupported job_type: ${job_type}`);
    }

    // Ensure job_runs table exists (handles existing DBs without migration)
    await JobRunsDB.ensureTable();

    const jobFileId = parseInt(job_id, 10);
    if (isNaN(jobFileId)) {
      return ApiErrors.badRequest('job_id must be a numeric file ID');
    }

    // Load the job file to get its content
    const jobFileResult = await FilesAPI.loadFile(jobFileId, user);
    const jobFile = jobFileResult.data;
    if (!jobFile?.content) {
      return ApiErrors.notFound('Job file');
    }

    // Create job_run record immediately (status=RUNNING)
    const runId = await JobRunsDB.create({
      job_id,
      job_type,
      company_id: user.companyId,
      source: 'manual',
    });

    // Execute the job handler
    const result = await handler.execute(job_id, jobFile.content, user, runId);

    // Persist the result file at /logs/runs/{timestamp} — timestamp avoids sequence
    // conflicts if job_runs table is ever reset while files table retains old entries.
    const runPath = resolvePath(user.mode, `/logs/runs/${Date.now()}`);
    const createResult = await FilesAPI.createFile(
      {
        name: `run-${runId}`,
        path: runPath,
        type: result.file_type,
        content: result.content,
        references: [jobFileId],
        options: { createPath: true },
      },
      user
    );
    const resultFileId = createResult.data.id;

    // Complete the job_run record
    const error = result.status === 'FAILURE' ? (result.content as any).error ?? 'Job failed' : undefined;
    await JobRunsDB.complete(runId, result.status, resultFileId, result.file_type, error);

    return successResponse({ runId, fileId: resultFileId, status: result.status });
  } catch (error) {
    return handleApiError(error);
  }
});
