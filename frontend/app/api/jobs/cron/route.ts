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
import { withCronAuth } from '@/lib/api/with-auth';
import { successResponse, handleApiError } from '@/lib/api/api-responses';
import { JobRunsDB } from '@/lib/database/job-runs-db';
import { CompanyDB } from '@/lib/database/company-db';
import { FilesAPI } from '@/lib/data/files.server';
import { resolvePath } from '@/lib/mode/path-resolver';
import { JOB_DEFINITIONS } from '@/lib/jobs/job-definitions';
import { JOB_HANDLERS } from '@/lib/jobs/job-registry';
import { getConfigsByCompanyId } from '@/lib/data/configs.server';
import { sendEmailViaWebhook, sendPhoneAlertViaWebhook } from '@/lib/messaging/webhook-executor';
import { resolveWebhook } from '@/lib/messaging/webhook-resolver.server';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import type { AlertContent, ScheduledJobContent, MessageAttemptLog, RunFileContent, RunMessageRecord } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

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

/**
 * Walk backwards minute-by-minute from `now` to find the most recent time
 * the cron expression was scheduled to fire. Returns null if not found within
 * the search bound (default 1 year = 525,600 minutes).
 */
function getPrevFireTime(cronExpr: string, now: Date, maxMinutes = 525_600): Date | null {
  // Start from the current minute (truncate seconds/ms)
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);

  for (let i = 0; i < maxMinutes; i++) {
    if (isCronDue(cronExpr, candidate)) return new Date(candidate);
    candidate.setMinutes(candidate.getMinutes() - 1);
  }
  return null;
}

// ---------------------------------------------------------------------------

async function runForCompany(
  companyId: number,
  now: Date
): Promise<{ triggered: number; skipped: number; failed: number }> {
  const user: EffectiveUser = {
    userId: -1,
    email: 'cron@system',
    name: 'Cron',
    role: 'admin',
    home_folder: '',
    companyId,
    mode: 'org',
  };

  let triggered = 0;
  let skipped = 0;
  let failed = 0;

  for (const jobDef of JOB_DEFINITIONS) {
    const handler = JOB_HANDLERS[jobDef.job_type];
    if (!handler) continue;

    const { data: fileInfos } = await FilesAPI.getFiles({ type: jobDef.file_type, depth: -1 }, user);
    const { data: allFiles } = fileInfos.length > 0
      ? await FilesAPI.loadFiles(fileInfos.map(f => f.id), user)
      : { data: [] };

    for (const jobFile of allFiles) {
      const content = jobFile.content as ScheduledJobContent | null;
      if (!content || !jobDef.isActive(content)) { skipped++; continue; }

      // Skip if suppressed (cron runs only; manual "Run Now" bypasses this entirely).
      if (content.suppressUntil) {
        const suppressEnd = new Date(content.suppressUntil);
        suppressEnd.setHours(23, 59, 59, 999);
        if (suppressEnd >= now) { skipped++; continue; }
      }

      if (jobDef.job_type === 'alert') {
        const alert = content as AlertContent;
        if (!alert.schedule?.cron) { skipped++; continue; }
        if (!alert.tests || alert.tests.length === 0) { skipped++; continue; }
      }

      const jobId = String(jobFile.id);

      const cronExpr = jobDef.job_type === 'alert'
        ? (content as AlertContent).schedule!.cron!
        : null;
      const prevFire = cronExpr ? getPrevFireTime(cronExpr, now) : null;

      // Skip if no prev fire time found (cron expression never matches).
      if (cronExpr && !prevFire) { skipped++; continue; }

      // Skip if the last scheduled fire time was more than 1 hour ago.
      // This tolerates scheduler delays (e.g. GHA queue) while preventing stale
      // daily/weekly jobs from firing hours after their scheduled time.
      const MAX_CRON_DELAY_MS = 60 * 60 * 1000;
      if (prevFire && now.getTime() - prevFire.getTime() > MAX_CRON_DELAY_MS) {
        skipped++;
        continue;
      }

      const windowStart = prevFire ?? new Date(now.getTime() - 60_000);
      const { runId, isNewRun } = await JobRunsDB.findOrCreate({
        job_id: jobId,
        job_type: jobDef.job_type,
        company_id: user.companyId,
        window_start: windowStart,
        window_end: now,
        source: 'cron',
      });

      if (!isNewRun) { skipped++; continue; }

      const previousRuns = await JobRunsDB.getByJobId(jobId, jobDef.job_type, user.companyId, 10);
      const startedAt = new Date().toISOString();

      const runPath = resolvePath(user.mode, `/logs/runs/${Date.now()}`);
      const initialContent: RunFileContent = { job_type: jobDef.job_type, status: 'running', startedAt };
      let runFileId: number;
      let runFileName: string;
      let runFilePath: string;

      try {
        const createResult = await FilesAPI.createFile(
          { name: `run-${jobId}-${jobDef.job_type}`, path: runPath, type: 'alert_run', content: initialContent, references: [jobFile.id], options: { createPath: true } },
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

      await JobRunsDB.setOutputFile(runId, runFileId, 'alert_run');

      try {
        const result = await handler.execute(
          { runFileId, jobId, jobType: jobDef.job_type, file: content, previousRuns },
          user
        );

        const messages: RunMessageRecord[] = result.messages.map((m) => ({ ...m, status: 'pending' }));
        const successContent: RunFileContent = {
          job_type: jobDef.job_type, status: 'success', startedAt,
          completedAt: new Date().toISOString(), output: result.output, messages,
        };
        await FilesAPI.saveFile(runFileId, runFileName, runFilePath, successContent, [jobFile.id], user);

        const { config } = await getConfigsByCompanyId(user.companyId, user.mode);
        const _emailRaw = config.messaging?.webhooks?.find(w => w.type === 'email_alert');
        const emailWebhook = _emailRaw ? resolveWebhook(_emailRaw) : null;
        const _phoneRaw = config.messaging?.webhooks?.find(w => w.type === 'phone_alert');
        const phoneAlertWebhook = _phoneRaw ? resolveWebhook(_phoneRaw) : null;
        for (const msg of messages) {
          try {
            if (msg.type === 'email_alert') {
              if (!emailWebhook) {
                msg.status = 'failed';
                msg.deliveryError = 'No email_alert webhook configured';
              } else {
                const r = await sendEmailViaWebhook(emailWebhook, msg.metadata.to, msg.metadata.subject, msg.content);
                const attemptLog: MessageAttemptLog = { attemptedAt: new Date().toISOString(), success: r.success, statusCode: r.statusCode, error: r.error, requestBody: r.requestBody, responseBody: r.responseBody };
                msg.logs = [...(msg.logs ?? []), attemptLog];
                msg.status = r.success ? 'sent' : 'failed';
                if (r.success) msg.sentAt = new Date().toISOString();
                else msg.deliveryError = r.error ?? `HTTP ${r.statusCode}`;
              }
            } else if (msg.type === 'phone_alert') {
              if (!phoneAlertWebhook) {
                msg.status = 'failed';
                msg.deliveryError = 'No phone_alert webhook configured';
              } else {
                const r = await sendPhoneAlertViaWebhook(phoneAlertWebhook, msg.metadata.to, msg.content, { title: msg.metadata.title, desc: msg.metadata.desc, link: msg.metadata.link, summary: msg.metadata.summary });
                const attemptLog: MessageAttemptLog = { attemptedAt: new Date().toISOString(), success: r.success, statusCode: r.statusCode, error: r.error, requestBody: r.requestBody, responseBody: r.responseBody };
                msg.logs = [...(msg.logs ?? []), attemptLog];
                msg.status = r.success ? 'sent' : 'failed';
                if (r.success) msg.sentAt = new Date().toISOString();
                else msg.deliveryError = r.error ?? `HTTP ${r.statusCode}`;
              }
            }
          } catch (err) {
            const deliveryError = err instanceof Error ? err.message : 'Unknown delivery error';
            msg.logs = [...(msg.logs ?? []), { attemptedAt: new Date().toISOString(), success: false, error: deliveryError }];
            msg.status = 'failed';
            msg.deliveryError = deliveryError;
          }
        }

        if (messages.length > 0) {
          await FilesAPI.saveFile(runFileId, runFileName, runFilePath, { ...successContent, messages }, [jobFile.id], user);
        }

        await JobRunsDB.complete(runId, 'SUCCESS');
        triggered++;
      } catch (execError) {
        const errorMessage = execError instanceof Error ? execError.message : 'Unknown error';
        const failureContent: RunFileContent = {
          job_type: jobDef.job_type, status: 'failure', startedAt,
          completedAt: new Date().toISOString(), error: errorMessage,
        };
        await FilesAPI.saveFile(runFileId, runFileName, runFilePath, failureContent, [jobFile.id], user);
        await JobRunsDB.complete(runId, 'FAILURE', errorMessage);
        failed++;
      }
    }
  }

  if (failed > 0) {
    appEventRegistry.publish(AppEvents.JOB_CRON_FAILED, { companyId, mode: 'org', triggered, skipped, failed });
  } else if (triggered > 0) {
    appEventRegistry.publish(AppEvents.JOB_CRON_SUCCEEDED, { companyId, mode: 'org', triggered, skipped });
  }

  return { triggered, skipped, failed };
}

export const POST = withCronAuth(async (request: NextRequest) => {
  try {
    const body = await request.json().catch(() => ({}));
    const requestedIds: number[] = Array.isArray(body.company_ids) ? body.company_ids : [];

    await JobRunsDB.ensureTable();

    const now = new Date();
    const companyIds = requestedIds.length > 0
      ? requestedIds
      : (await CompanyDB.listAll()).map(c => c.id);

    const resultArray = await Promise.all(companyIds.map(id => runForCompany(id, now)));
    const results = Object.fromEntries(companyIds.map((id, i) => [id, resultArray[i]]));

    return successResponse({ results });
  } catch (error) {
    return handleApiError(error);
  }
});
