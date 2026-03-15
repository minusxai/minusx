/**
 * POST /api/jobs/cron
 * Called by an external cron on a per-minute schedule.
 * Iterates JOB_DEFINITIONS, loads all matching files, filters by isActive,
 * and dispatches each to the corresponding JOB_HANDLERS entry.
 *
 * External trigger options:
 *   - Vercel Cron Jobs (vercel.json)
 *   - Railway cron
 *   - Any scheduler that can POST to this endpoint
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { successResponse, handleApiError } from '@/lib/api/api-responses';
import { JobRunsDB } from '@/lib/database/job-runs-db';
import { FilesAPI } from '@/lib/data/files.server';
import { DocumentDB } from '@/lib/database/documents-db';
import { resolvePath } from '@/lib/mode/path-resolver';
import { JOB_DEFINITIONS } from '@/lib/jobs/job-definitions';
import { JOB_HANDLERS } from '@/lib/jobs/job-registry';
import { sendEmail } from '@/lib/email/send-email';
import type { AlertContent, RunFileContent, RunMessageRecord } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Minimal cron expression evaluator (handles *, numbers, ranges, lists, steps)
// Format: "minute hour day-of-month month day-of-week"
// ---------------------------------------------------------------------------
function matchesCronField(expr: string, value: number): boolean {
  if (expr === '*') return true;

  // Handle list: "1,2,5"
  if (expr.includes(',')) {
    return expr.split(',').some((part) => matchesCronField(part.trim(), value));
  }

  // Handle step: "*/5" or "0-59/5"
  if (expr.includes('/')) {
    const [rangeExpr, stepStr] = expr.split('/');
    const step = parseInt(stepStr, 10);
    if (isNaN(step) || step <= 0) return false;
    if (rangeExpr === '*') return value % step === 0;
    // range/step
    if (rangeExpr.includes('-')) {
      const [start, end] = rangeExpr.split('-').map(Number);
      if (value < start || value > end) return false;
      return (value - start) % step === 0;
    }
    return false;
  }

  // Handle range: "1-5"
  if (expr.includes('-')) {
    const [start, end] = expr.split('-').map(Number);
    return value >= start && value <= end;
  }

  // Literal number
  return parseInt(expr, 10) === value;
}

function isCronDue(cronExpr: string, date: Date): boolean {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, month, dow] = parts;
  return (
    matchesCronField(min, date.getMinutes()) &&
    matchesCronField(hour, date.getHours()) &&
    matchesCronField(dom, date.getDate()) &&
    matchesCronField(month, date.getMonth() + 1) &&
    matchesCronField(dow, date.getDay())
  );
}

// ---------------------------------------------------------------------------

export const POST = withAuth(async (_request: NextRequest, user) => {
  try {
    await JobRunsDB.ensureTable();

    const now = new Date();

    let triggered = 0;
    let skipped = 0;
    let failed = 0;

    for (const jobDef of JOB_DEFINITIONS) {
      const handler = JOB_HANDLERS[jobDef.job_type];
      if (!handler) continue;

      // Load all files of this job type for this company
      const allFiles = await DocumentDB.listAll(user.companyId, jobDef.file_type, undefined, -1, true);

      for (const jobFile of allFiles) {
        const content = jobFile.content as AlertContent | null;
        if (!content || !jobDef.isActive(content)) { skipped++; continue; }

        // For alerts, check schedule
        if (jobDef.job_type === 'alert') {
          const alert = content as AlertContent;
          if (!alert.schedule?.cron || !isCronDue(alert.schedule.cron, now)) { skipped++; continue; }
          if (!alert.questionId || alert.questionId <= 0) { skipped++; continue; }
        }

        const jobId = String(jobFile.id);

        // Dedup: skip if a run already exists in the current minute window (±30s)
        const windowStart = new Date(now.getTime() - 30_000);
        const windowEnd = new Date(now.getTime() + 30_000);
        const { runId, isNewRun } = await JobRunsDB.findOrCreate({
          job_id: jobId,
          job_type: jobDef.job_type,
          company_id: user.companyId,
          window_start: windowStart,
          window_end: windowEnd,
          source: 'cron',
        });

        if (!isNewRun) { skipped++; continue; }

        const previousRuns = await JobRunsDB.getByJobId(jobId, jobDef.job_type, user.companyId, 10);
        const startedAt = new Date().toISOString();

        // Create run file upfront with status='running'
        const runPath = resolvePath(user.mode, `/logs/runs/${Date.now()}`);
        const initialContent: RunFileContent = {
          job_type: jobDef.job_type,
          status: 'running',
          startedAt,
        };
        let runFileId: number;
        let runFileName: string;
        let runFilePath: string;

        try {
          const createResult = await FilesAPI.createFile(
            {
              name: `run-${jobId}-${jobDef.job_type}`,
              path: runPath,
              type: 'alert_run',
              content: initialContent,
              references: [jobFile.id],
              options: { createPath: true },
            },
            user
          );
          runFileId = createResult.data.id;
          runFileName = createResult.data.name;
          runFilePath = createResult.data.path;
        } catch (createErr) {
          const errorMessage = createErr instanceof Error ? createErr.message : 'Unknown error';
          console.error(`[cron] Failed to create run file for job ${jobId}:`, errorMessage);
          await JobRunsDB.complete(runId, 'FAILURE', errorMessage);
          failed++;
          continue;
        }

        // Link the run file to the job_run record
        await JobRunsDB.setOutputFile(runId, runFileId, 'alert_run');

        try {
          const result = await handler.execute(
            { runFileId, jobId, jobType: jobDef.job_type, file: content, previousRuns },
            user
          );

          // Build message records (pending)
          const messages: RunMessageRecord[] = result.messages.map((m) => ({ ...m, status: 'pending' }));

          const successContent: RunFileContent = {
            job_type: jobDef.job_type,
            status: 'success',
            startedAt,
            completedAt: new Date().toISOString(),
            output: result.output,
            messages,
          };
          await FilesAPI.saveFile(runFileId, runFileName, runFilePath, successContent, [jobFile.id], user);

          // Deliver messages
          for (const msg of messages) {
            if (msg.type === 'email') {
              try {
                await sendEmail(
                  msg.metadata.to,
                  msg.metadata.subject,
                  msg.content,
                  undefined,
                  msg.metadata.batch
                );
                msg.status = 'sent';
                msg.sentAt = new Date().toISOString();
              } catch (err) {
                msg.status = 'failed';
                msg.deliveryError = err instanceof Error ? err.message : 'Unknown delivery error';
              }
            }
          }

          if (messages.length > 0) {
            await FilesAPI.saveFile(
              runFileId,
              runFileName,
              runFilePath,
              { ...successContent, messages },
              [jobFile.id],
              user
            );
          }

          await JobRunsDB.complete(runId, 'SUCCESS');
          triggered++;
        } catch (execError) {
          const errorMessage = execError instanceof Error ? execError.message : 'Unknown error';
          const failureContent: RunFileContent = {
            job_type: jobDef.job_type,
            status: 'failure',
            startedAt,
            completedAt: new Date().toISOString(),
            error: errorMessage,
          };
          await FilesAPI.saveFile(runFileId, runFileName, runFilePath, failureContent, [jobFile.id], user);
          await JobRunsDB.complete(runId, 'FAILURE', errorMessage);
          failed++;
        }
      }
    }

    return successResponse({ triggered, skipped, failed });
  } catch (error) {
    return handleApiError(error);
  }
});
