/**
 * Cron scan orchestration — the business logic behind `POST /api/jobs/cron`.
 * Iterates JOB_DEFINITIONS, loads all matching files, filters by isActive,
 * and dispatches each due job to its registered JOB_HANDLERS entry.
 *
 * The cron *expression* for a job comes from `JobDefinition.getCron`
 * (`lib/jobs/job-definitions.ts`); it's evaluated here via
 * `getPrevFireTime` (`lib/jobs/cron.ts`) — one cron abstraction split across
 * "where the schedule lives" and "what time it last fired", not two.
 */
import 'server-only';
import { JobRunsDB } from '@/lib/database/job-runs-db';
import { FilesAPI } from '@/lib/data/files.server';
import { resolvePath } from '@/lib/mode/path-resolver';
import type { Mode } from '@/lib/mode/mode-types';
import { JOB_DEFINITIONS } from '@/lib/jobs/job-definitions';
import { JOB_HANDLERS } from '@/lib/jobs/job-registry';
import { getConfigsForMode } from '@/lib/data/configs.server';
import { getPrevFireTime } from '@/lib/jobs/cron';
import { deliverMessages } from '@/lib/jobs/deliver-messages';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import type { AlertContent, ScheduledJobContent, RunFileContent, RunMessageRecord } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

export interface CronScanResult {
  triggered: number;
  skipped: number;
  failed: number;
}

/**
 * Scan every registered job definition, load its matching active files, and
 * dispatch each one that's due (or, for job types with no cron gating, every
 * active file) to its handler. Called on a per-minute external cron tick.
 */
export async function runForOrg(now: Date): Promise<CronScanResult> {
  const user: EffectiveUser = {
    userId: -1,
    email: 'cron@system',
    name: 'Cron',
    role: 'admin',
    home_folder: '',
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
        if (!alert.tests || alert.tests.length === 0) { skipped++; continue; }
      }

      const jobId = String(jobFile.id);

      const cronExpr = jobDef.getCron ? jobDef.getCron(content) : null;
      if (jobDef.getCron && !cronExpr) { skipped++; continue; }
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
        window_start: windowStart,
        window_end: now,
        source: 'cron',
      });

      if (!isNewRun) { skipped++; continue; }

      const previousRuns = await JobRunsDB.getByJobId(jobId, jobDef.job_type, 10);
      const startedAt = new Date().toISOString();

      // Derive mode from the job file's path (first segment: /org/... → 'org')
      const jobMode = (jobFile.path.split('/').filter(Boolean)[0] ?? user.mode) as Mode;
      const jobUser: EffectiveUser = { ...user, mode: jobMode };

      const runPath = resolvePath(jobMode, `/logs/runs/${Date.now()}`);
      const initialContent: RunFileContent = { job_type: jobDef.job_type, status: 'running', startedAt };
      let runFileId: number;
      let runFileName: string;
      let runFilePath: string;

      try {
        const createResult = await FilesAPI.createFile(
          { name: `run-${jobId}-${jobDef.job_type}`, path: runPath, type: 'alert_run', content: initialContent, references: [jobFile.id], options: { createPath: true } },
          jobUser
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
          jobUser
        );

        const messages: RunMessageRecord[] = result.messages.map((m) => ({ ...m, status: 'pending' }));
        // Handlers can report failure without throwing (same contract as /api/jobs/run)
        const runStatus = result.status === 'failure' ? 'failure' : 'success';
        const successContent: RunFileContent = {
          job_type: jobDef.job_type, status: runStatus, startedAt,
          completedAt: new Date().toISOString(), output: result.output, messages,
        };
        await FilesAPI.saveFile(runFileId, runFileName, runFilePath, successContent, [jobFile.id], jobUser);

        if (messages.length > 0) {
          const { config } = await getConfigsForMode(jobUser.mode);
          // slack_alert is intentionally excluded here: the pre-existing cron
          // path never delivered it (no slack import/branch at all), so
          // Slack-channel alert recipients on a cron schedule silently sat at
          // 'pending' forever. That's a real latent bug — fixing it is a
          // production delivery-behavior change that needs explicit product
          // sign-off, not something to ship as a side effect of a code-dedup
          // refactor. See Refactor-v2.md M5.5 for the flagged follow-up.
          await deliverMessages(messages, config, { send: true, skipTypes: ['slack_alert'] });
          await FilesAPI.saveFile(runFileId, runFileName, runFilePath, { ...successContent, messages }, [jobFile.id], jobUser);
        }

        if (runStatus === 'failure') {
          await JobRunsDB.complete(runId, 'FAILURE', 'Handler reported failure — see run file output');
          failed++;
        } else {
          await JobRunsDB.complete(runId, 'SUCCESS');
          triggered++;
        }
      } catch (execError) {
        const errorMessage = execError instanceof Error ? execError.message : 'Unknown error';
        const failureContent: RunFileContent = {
          job_type: jobDef.job_type, status: 'failure', startedAt,
          completedAt: new Date().toISOString(), error: errorMessage,
        };
        await FilesAPI.saveFile(runFileId, runFileName, runFilePath, failureContent, [jobFile.id], jobUser);
        await JobRunsDB.complete(runId, 'FAILURE', errorMessage);
        failed++;
      }
    }
  }

  if (failed > 0) {
    appEventRegistry.publish(AppEvents.JOB_CRON_FAILED, { mode: user.mode, triggered, skipped, failed });
  } else if (triggered > 0) {
    appEventRegistry.publish(AppEvents.JOB_CRON_SUCCEEDED, { mode: user.mode, triggered, skipped });
  }

  return { triggered, skipped, failed };
}
