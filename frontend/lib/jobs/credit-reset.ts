import 'server-only';
import { JobRunsDB } from '@/lib/database/job-runs-db';
import { getPrevFireTime } from '@/lib/jobs/cron';
import { getConfigsForMode } from '@/lib/data/configs.server';
import { resolveResetSchedule, type CreditsConfig } from '@/lib/analytics/credit-policy';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';

// Same lag tolerance as cron-scan: fire only if the scheduled time was within
// the last hour, so a delayed scheduler tick still fires but a long outage
// doesn't retro-fire a stale reset.
const MAX_CRON_DELAY_MS = 60 * 60 * 1000;

/**
 * Global auto credit-reset pass, run on the same cron tick as the file jobs.
 * For the daily + weekly reset crons (config `credits.dailyResetCron` /
 * `weeklyResetCron`, evaluated in `resetTimeZone`, LA defaults), fire a
 * company-wide CREDIT_RESET exactly ONCE per scheduled window — dedup via
 * `JobRunsDB.findOrCreate(window_start = prevFire)`, the same mechanism alerts
 * use. The event is recorded to `app_events` (so it shows in the admin feed) and
 * the usage windows floor at it.
 */
export async function runCreditResets(now: Date): Promise<{ fired: number }> {
  let credits: CreditsConfig | undefined;
  try {
    credits = (await getConfigsForMode('org')).config.credits as CreditsConfig | undefined;
  } catch {
    credits = undefined;
  }
  const { dailyCron, weeklyCron, timeZone } = resolveResetSchedule(credits);

  let fired = 0;
  const jobs: Array<[string, string]> = [['credit-reset-daily', dailyCron], ['credit-reset-weekly', weeklyCron]];
  for (const [jobId, cron] of jobs) {
    const prevFire = getPrevFireTime(cron, now, 525_600, timeZone);
    if (!prevFire) continue;
    if (now.getTime() - prevFire.getTime() > MAX_CRON_DELAY_MS) continue;

    const { runId, isNewRun } = await JobRunsDB.findOrCreate({
      job_id: jobId, job_type: 'credit_reset', window_start: prevFire, window_end: now, source: 'cron',
    });
    if (!isNewRun) continue;

    try {
      appEventRegistry.publish(AppEvents.CREDIT_RESET, { mode: 'org', scope: 'company', target: 'company', auto: true });
      await JobRunsDB.complete(runId, 'SUCCESS');
      fired++;
    } catch (e) {
      await JobRunsDB.complete(runId, 'FAILURE', e instanceof Error ? e.message : 'credit reset failed');
    }
  }
  return { fired };
}
