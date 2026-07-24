vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));
// A cron that matches every minute → always "due now", so the test is time-independent.
vi.mock('@/lib/data/configs.server', () => ({
  getConfigsForMode: vi.fn(async () => ({ config: { credits: { dailyResetCron: '* * * * *', weeklyResetCron: '* * * * *' } } })),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCreditResets } from '@/lib/jobs/credit-reset';
import { appEventRegistry } from '@/lib/app-event-registry';
import { AppEvents } from '@/lib/app-event-registry/events';
import { JobRunsDB } from '@/lib/database/job-runs-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

setupTestDb(getTestDbPath('credit_reset_job'));

describe('runCreditResets', () => {
  beforeEach(async () => {
    await JobRunsDB.ensureTable();
    vi.clearAllMocks();
  });

  it('fires daily + weekly company resets once per window, deduped via JobRunsDB', async () => {
    const spy = vi.spyOn(appEventRegistry, 'publish');
    const now = new Date();

    const first = await runCreditResets(now);
    expect(first.fired).toBe(2); // daily + weekly both due

    const resets = spy.mock.calls.filter((c) => c[0] === AppEvents.CREDIT_RESET);
    expect(resets.length).toBe(2);
    expect(resets[0][1]).toMatchObject({ scope: 'company', target: 'company', auto: true });

    // Second run in the same minute window → both already recorded → no re-fire.
    spy.mockClear();
    const second = await runCreditResets(now);
    expect(second.fired).toBe(0);
    expect(spy.mock.calls.filter((c) => c[0] === AppEvents.CREDIT_RESET).length).toBe(0);
  });
});
