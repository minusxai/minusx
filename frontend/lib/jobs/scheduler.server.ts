import 'server-only';
import { JobRunsDB } from '@/lib/database/job-runs-db';
import { runForOrg } from '@/lib/jobs/cron-scan';
import { runCreditResets } from '@/lib/jobs/credit-reset';

/**
 * In-app cron scheduler. The app used to rely on an EXTERNAL service POSTing
 * `/api/jobs/cron` on a schedule; that service is gone, so scheduled jobs
 * (alerts, reports, sheets-sync, credit resets) stopped firing. This runs the
 * same scan in-process on a timer instead.
 *
 * Reliability: safe across multiple instances (every job dedups via
 * `JobRunsDB.findOrCreate(window_start=prevFire)`, so a window fires once no
 * matter how many tickers run); survives restarts (the timer just resumes, and
 * the 1h `MAX_CRON_DELAY` in cron-scan still catches a just-missed daily/weekly
 * fire). Requires a long-lived Node process (not pure serverless). Jobs fire up
 * to one interval late, so the interval must stay ≤ that 1h tolerance.
 *
 * Interval: `CRON_INTERVAL_MINUTES` (default 5). Disable with `CRON_IN_APP=false`
 * (e.g. when an external trigger is still wired). The `/api/jobs/cron` endpoint
 * stays available for manual/external triggering regardless.
 */
let started = false;

async function tick(): Promise<void> {
  try {
    await JobRunsDB.ensureTable();
    const now = new Date();
    await runForOrg(now);
    await runCreditResets(now);
  } catch (e) {
    console.warn('[cron-scheduler] tick failed (non-fatal):', e);
  }
}

export function startCronScheduler(): void {
  if (started) return;
  // eslint-disable-next-line no-restricted-syntax -- server-only infra timing knob (mirrors instrumentation.ts env reads); not a client value
  if (process.env.CRON_IN_APP === 'false') return;
  started = true;

  // eslint-disable-next-line no-restricted-syntax -- see above
  const raw = Number(process.env.CRON_INTERVAL_MINUTES);
  const minutes = Number.isFinite(raw) && raw > 0 && raw <= 60 ? raw : 5;
  const ms = minutes * 60_000;

  // First tick shortly after boot (let the server settle), then every interval.
  setTimeout(() => { void tick(); }, 30_000);
  const handle = setInterval(() => { void tick(); }, ms);
  // Don't keep the event loop alive just for the timer (the HTTP server does that).
  handle.unref?.();
  console.log(`[cron-scheduler] in-app scheduler started (every ${minutes}m)`);
}
