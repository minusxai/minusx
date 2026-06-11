/**
 * decideRecoveryAction — the page error boundary's auto-recovery state machine.
 *
 * A deterministic render error remounts app/error.tsx on every reset(), so an
 * unbounded auto-reset spins forever: the page never recovers and the tab posts
 * a capture-error report every dedup window (the "one Slack report per minute,
 * forever" incident from a stale tab at a customer deployment). The decision is:
 *   1. reset()  — up to MAX_AUTO_RESETS times per error message per loop window
 *   2. reload   — ONE guarded hard reload (a stale tab picks up the fixed build)
 *   3. fallback — give up and render a manual-recovery UI (loop ends)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type ErrorRecoveryModule = typeof import('@/lib/utils/error-recovery');

async function freshModule(): Promise<ErrorRecoveryModule> {
  vi.resetModules();
  return await import('@/lib/utils/error-recovery');
}

function fakeStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    dump: () => Object.fromEntries(m),
  };
}

const T0 = 1_000_000;

describe('decideRecoveryAction', () => {
  let mod: ErrorRecoveryModule;

  beforeEach(async () => {
    mod = await freshModule();
  });

  it('auto-resets for the first MAX_AUTO_RESETS occurrences of an error', () => {
    const storage = fakeStorage();
    for (let i = 0; i < mod.MAX_AUTO_RESETS; i++) {
      expect(mod.decideRecoveryAction('boom', { now: T0 + i, storage })).toBe('reset');
    }
  });

  it('hard-reloads exactly once when the cap is exceeded, then falls back', () => {
    const storage = fakeStorage();
    for (let i = 0; i < mod.MAX_AUTO_RESETS; i++) {
      mod.decideRecoveryAction('boom', { now: T0 + i, storage });
    }
    expect(mod.decideRecoveryAction('boom', { now: T0 + 10, storage })).toBe('reload');
    // The loop continues after the reload didn't help (same page load or a
    // fresh load that recorded the guard): no second automatic reload.
    expect(mod.decideRecoveryAction('boom', { now: T0 + 20, storage })).toBe('fallback');
  });

  it('does not reload again on a fresh page load while the storage guard is active', async () => {
    const storage = fakeStorage();
    for (let i = 0; i < mod.MAX_AUTO_RESETS; i++) mod.decideRecoveryAction('boom', { now: T0 + i, storage });
    expect(mod.decideRecoveryAction('boom', { now: T0 + 10, storage })).toBe('reload');

    // Simulate the post-reload page: module state is fresh, sessionStorage survives.
    const reloaded = await freshModule();
    for (let i = 0; i < reloaded.MAX_AUTO_RESETS; i++) {
      expect(reloaded.decideRecoveryAction('boom', { now: T0 + 100 + i, storage })).toBe('reset');
    }
    expect(reloaded.decideRecoveryAction('boom', { now: T0 + 200, storage })).toBe('fallback');
  });

  it('allows another reload after the guard window expires', () => {
    const storage = fakeStorage();
    for (let i = 0; i < mod.MAX_AUTO_RESETS; i++) mod.decideRecoveryAction('boom', { now: T0 + i, storage });
    expect(mod.decideRecoveryAction('boom', { now: T0 + 10, storage })).toBe('reload');

    const later = T0 + mod.RELOAD_GUARD_WINDOW_MS + 1_000;
    for (let i = 0; i < mod.MAX_AUTO_RESETS; i++) mod.decideRecoveryAction('boom', { now: later + i, storage });
    expect(mod.decideRecoveryAction('boom', { now: later + 10, storage })).toBe('reload');
  });

  it('tracks attempt counts per error message independently', () => {
    const storage = fakeStorage();
    for (let i = 0; i < mod.MAX_AUTO_RESETS; i++) mod.decideRecoveryAction('boom', { now: T0 + i, storage });
    // A different error message starts its own count.
    expect(mod.decideRecoveryAction('other', { now: T0 + 10, storage })).toBe('reset');
  });

  it('treats occurrences separated by more than the loop window as sporadic (keeps resetting)', () => {
    const storage = fakeStorage();
    let now = T0;
    for (let i = 0; i < mod.MAX_AUTO_RESETS * 3; i++) {
      expect(mod.decideRecoveryAction('boom', { now, storage })).toBe('reset');
      now += mod.LOOP_WINDOW_MS + 1_000;
    }
  });

  it('falls back instead of reloading when no storage is available to record the guard', () => {
    // Without a guard record, an automatic reload could loop at reload frequency.
    for (let i = 0; i < mod.MAX_AUTO_RESETS; i++) {
      mod.decideRecoveryAction('boom', { now: T0 + i, storage: undefined });
    }
    expect(mod.decideRecoveryAction('boom', { now: T0 + 10, storage: undefined })).toBe('fallback');
  });

  it('falls back instead of reloading when storage throws (e.g. privacy mode)', () => {
    const throwing = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    };
    for (let i = 0; i < mod.MAX_AUTO_RESETS; i++) {
      mod.decideRecoveryAction('boom', { now: T0 + i, storage: throwing });
    }
    expect(mod.decideRecoveryAction('boom', { now: T0 + 10, storage: throwing })).toBe('fallback');
  });
});
