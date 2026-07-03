/**
 * withToolWatchdog — the bridge safety net. A frontend tool whose handler never settles (hung
 * fetch with no timeout, a query with timeouts disabled) used to leave the conversation stuck in
 * "executing" forever: completeToolCall was never dispatched. The watchdog bounds every tool
 * execution; a late settlement after the watchdog fires is swallowed (no double completion).
 */
import { describe, it, expect, vi } from 'vitest';
import { withToolWatchdog, ToolWatchdogTimeout } from '../tool-watchdog';

describe('withToolWatchdog', () => {
  it('passes through a resolution that beats the deadline', async () => {
    await expect(withToolWatchdog(Promise.resolve('ok'), 'ReadFiles', 1000)).resolves.toBe('ok');
  });

  it('passes through a rejection that beats the deadline (e.g. UserInputException)', async () => {
    const boom = new Error('needs user input');
    await expect(withToolWatchdog(Promise.reject(boom), 'Navigate', 1000)).rejects.toBe(boom);
  });

  it('rejects with ToolWatchdogTimeout when the work never settles', async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<never>(() => {});
      const raced = withToolWatchdog(never, 'ReadFiles', 5000);
      const assertion = expect(raced).rejects.toBeInstanceOf(ToolWatchdogTimeout);
      await vi.advanceTimersByTimeAsync(5001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('names the tool and the timeout in the error message (the agent reads this)', async () => {
    vi.useFakeTimers();
    try {
      const raced = withToolWatchdog(new Promise<never>(() => {}), 'ReadFiles', 300000);
      const assertion = raced.catch((e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(300001);
      const message = await assertion;
      expect(message).toContain('ReadFiles');
      expect(message).toContain('300');
    } finally {
      vi.useRealTimers();
    }
  });

  it('swallows a LATE settlement after the watchdog fired (no unhandled rejection, no double result)', async () => {
    vi.useFakeTimers();
    try {
      let lateReject!: (e: Error) => void;
      const work = new Promise<never>((_, rej) => { lateReject = rej; });
      const raced = withToolWatchdog(work, 'EditFile', 1000);
      const assertion = expect(raced).rejects.toBeInstanceOf(ToolWatchdogTimeout);
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
      // The underlying work rejects AFTER the watchdog already settled — must not surface anywhere.
      lateReject(new Error('late failure'));
      await vi.advanceTimersByTimeAsync(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
