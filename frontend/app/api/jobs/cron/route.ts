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
import type { AlertContent } from '@/lib/types';

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
    // Dedup window: current minute ±30s
    const windowStart = new Date(now.getTime() - 30_000);
    const windowEnd = new Date(now.getTime() + 30_000);

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

        const { runId, isNewRun } = await JobRunsDB.findOrCreate({
          job_id: jobId,
          job_type: jobDef.job_type,
          company_id: user.companyId,
          window_start: windowStart,
          window_end: windowEnd,
          source: 'cron',
        });

        if (!isNewRun) { skipped++; continue; }

        try {
          const result = await handler.execute(jobId, content, user, runId);

          // Persist result file
          const runPath = resolvePath(user.mode, `/logs/runs/${runId}`);
          const createResult = await FilesAPI.createFile(
            {
              name: `run-${runId}`,
              path: runPath,
              type: result.file_type,
              content: result.content,
              references: [jobFile.id],
              options: { createPath: true },
            },
            user
          );

          const error = result.status === 'FAILURE' ? (result.content as any).error ?? 'Job failed' : undefined;
          await JobRunsDB.complete(runId, result.status, createResult.data.id, result.file_type, error);

          if (result.status === 'SUCCESS') {
            triggered++;
          } else {
            failed++;
          }
        } catch (execError) {
          const errorMessage = execError instanceof Error ? execError.message : 'Unknown error';
          await JobRunsDB.complete(runId, 'FAILURE', undefined, undefined, errorMessage);
          failed++;
        }
      }
    }

    return successResponse({ triggered, skipped, failed });
  } catch (error) {
    return handleApiError(error);
  }
});
