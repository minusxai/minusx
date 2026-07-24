import { describe, it, expect } from 'vitest';
import { matchesCronField, isCronDue, getPrevFireTime } from '@/lib/jobs/cron';

describe('matchesCronField', () => {
  it('handles *, literals, lists, ranges, and steps', () => {
    expect(matchesCronField('*', 5)).toBe(true);
    expect(matchesCronField('5', 5)).toBe(true);
    expect(matchesCronField('5', 6)).toBe(false);
    expect(matchesCronField('1,5,9', 5)).toBe(true);
    expect(matchesCronField('1-5', 3)).toBe(true);
    expect(matchesCronField('1-5', 6)).toBe(false);
    expect(matchesCronField('*/15', 30)).toBe(true);
    expect(matchesCronField('*/15', 31)).toBe(false);
  });
});

// America/Los_Angeles is UTC-7 in July (PDT), so 23:59 PDT on Fri 2026-07-24
// is 06:59 UTC on Sat 2026-07-25. The tz argument must make the cron fire on
// LA wall-clock time, not the server's.
const LA = 'America/Los_Angeles';

describe('isCronDue — timezone aware', () => {
  it('fires "59 23 * * *" at 11:59 PM Los Angeles regardless of server tz', () => {
    expect(isCronDue('59 23 * * *', new Date('2026-07-25T06:59:00Z'), LA)).toBe(true);
    // 23:59 UTC is only 16:59 in LA → NOT due.
    expect(isCronDue('59 23 * * *', new Date('2026-07-24T23:59:00Z'), LA)).toBe(false);
  });

  it('fires the weekly "59 23 * * 0" only at 11:59 PM Sunday LA', () => {
    // 2026-07-26 is a Sunday; 23:59 PDT Sun = 2026-07-27T06:59Z.
    expect(isCronDue('59 23 * * 0', new Date('2026-07-27T06:59:00Z'), LA)).toBe(true);
    // Same wall-clock time a day earlier (Saturday) → not due.
    expect(isCronDue('59 23 * * 0', new Date('2026-07-26T06:59:00Z'), LA)).toBe(false);
  });
});

describe('getPrevFireTime — timezone aware', () => {
  it('finds the most recent LA 11:59 PM before now', () => {
    const prev = getPrevFireTime('59 23 * * *', new Date('2026-07-25T07:30:00Z'), 525_600, LA);
    expect(prev?.toISOString()).toBe('2026-07-25T06:59:00.000Z');
  });
});
