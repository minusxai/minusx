/**
 * Manual/forced job-run orchestration — the business logic behind
 * `POST /api/jobs/run`.
 *
 * Flow:
 *  1. Look up the handler, validate job_id/job file
 *  2. Dedup: skip if a RUNNING run already exists for this job (unless forced)
 *  3. Create run file upfront with status='running'
 *  4. Create job_run record with output_file_id set immediately
 *  5. Execute handler → {output, messages}
 *  6. Deliver messages (email/phone/slack via `deliverMessages`), update run file with final statuses
 *  7. Complete job_run record
 */
import 'server-only';
import { JobRunsDB } from '@/lib/database/job-runs-db';
import { FilesAPI } from '@/lib/data/files.server';
import { resolvePath } from '@/lib/mode/path-resolver';
import { JOB_HANDLERS } from '@/lib/jobs/job-registry';
import { getConfigsForMode } from '@/lib/data/configs.server';
import { deliverMessages } from '@/lib/jobs/deliver-messages';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { RunFileContent, RunMessageRecord } from '@/lib/types';
import type { FileType } from '@/lib/ui/file-metadata';

export interface RunJobParams {
  jobId: string;
  jobType: string;
  force?: boolean;
  send?: boolean;
}

export type RunJobOutcome =
  | { kind: 'unsupported_job_type' }
  | { kind: 'invalid_job_id' }
  | { kind: 'not_found' }
  | { kind: 'already_running'; runId: number; fileId: number | null }
  | { kind: 'completed'; runId: number; fileId: number; status: 'SUCCESS' | 'FAILURE' };

/**
 * Orchestrate a single manual/forced job run. Mirrors the per-job body of
 * the cron scanner (`runForOrg` in `cron-scan.ts`), but triggered on demand
 * for one job rather than scanning every active file.
 */
export async function runJob(params: RunJobParams, user: EffectiveUser): Promise<RunJobOutcome> {
  const { jobId: job_id, jobType: job_type, force = false, send = true } = params;

  const handler = JOB_HANDLERS[job_type];
  if (!handler) {
    return { kind: 'unsupported_job_type' };
  }

  await JobRunsDB.ensureTable();

  const jobFileId = parseInt(job_id, 10);
  if (isNaN(jobFileId)) {
    return { kind: 'invalid_job_id' };
  }

  // Load the job file to get its content
  const jobFileResult = await FilesAPI.loadFile(jobFileId, user);
  const jobFile = jobFileResult.data;
  if (!jobFile?.content) {
    return { kind: 'not_found' };
  }

  // Dedup: skip if already running (force bypasses by using a 1s window)
  if (!force) {
    const existingRun = await JobRunsDB.getRunningByJobId(job_id, job_type);
    if (existingRun) {
      return { kind: 'already_running', runId: existingRun.id, fileId: existingRun.output_file_id };
    }
  }

  // Load previous runs for handler context
  const previousRuns = await JobRunsDB.getByJobId(job_id, job_type, 10);

  const startedAt = new Date().toISOString();

  // Create run file upfront with status='running'
  const runPath = resolvePath(user.mode, `/logs/runs/${Date.now()}`);
  const initialContent: RunFileContent = {
    job_type,
    status: 'running',
    startedAt,
  };
  const runFileType = `${job_type}_run` as FileType;
  const createResult = await FilesAPI.createFile(
    {
      name: `run-${job_id}-${job_type}`,
      path: runPath,
      type: runFileType,
      content: initialContent,
      references: [jobFileId],
      options: { createPath: true },
    },
    user
  );
  const runFile = createResult.data;
  const runFileId = runFile.id;

  // Create job_run record with output file linked upfront
  const runId = await JobRunsDB.create({
    job_id,
    job_type,
    output_file_id: runFileId,
    output_file_type: runFileType,
    source: 'manual',
  });

  try {
    const result = await handler.execute(
      { runFileId, jobId: job_id, jobType: job_type, file: jobFile.content, previousRuns },
      user
    );

    // Build message records (pending)
    const messages: RunMessageRecord[] = result.messages.map((m) => ({ ...m, status: 'pending' }));

    // Save run file with output + pending messages
    const runStatus = result.status === 'failure' ? 'failure' : 'success';
    const successContent: RunFileContent = {
      job_type,
      status: runStatus,
      startedAt,
      completedAt: new Date().toISOString(),
      output: result.output,
      messages,
    };
    await FilesAPI.saveFile(runFileId, runFile.name, runFile.path, successContent, [jobFileId], user);

    // Deliver messages (skipped when send=false)
    if (messages.length > 0) {
      const { config } = await getConfigsForMode(user.mode);
      await deliverMessages(messages, config, { send });

      // Save final message statuses if any messages were dispatched
      await FilesAPI.saveFile(
        runFileId,
        runFile.name,
        runFile.path,
        { ...successContent, messages },
        [jobFileId],
        user
      );
    }

    const jobRunStatus = result.status === 'failure' ? 'FAILURE' : 'SUCCESS';
    await JobRunsDB.complete(runId, jobRunStatus);
    return { kind: 'completed', runId, fileId: runFileId, status: jobRunStatus };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    const failureContent: RunFileContent = {
      job_type,
      status: 'failure',
      startedAt,
      completedAt: new Date().toISOString(),
      error: errorMessage,
    };
    await FilesAPI.saveFile(runFileId, runFile.name, runFile.path, failureContent, [jobFileId], user);
    await JobRunsDB.complete(runId, 'FAILURE', errorMessage);
    return { kind: 'completed', runId, fileId: runFileId, status: 'FAILURE' };
  }
}
