/**
 * Regression: the wizard's progress bar is a pure time-decay curve, so it claimed
 * near-completion on elapsed time alone. Measured on a real run: the onboarding context
 * agent produced its first token 5m03s after dispatch (all six messages then landed inside
 * 14s). Throughout those five minutes the bar sat pinned at 99% reading "Finishing up...",
 * because 80% — the threshold for that message — is reached in ~32s at the default tau.
 *
 * A user cannot tell that state apart from a hung run, and the copy actively says the
 * opposite of the truth. Two guarantees fix it:
 *   1. the curve is capped below the final-stage message thresholds, so time alone can
 *      never claim the last stage;
 *   2. past a threshold the hook reports `isSlow`, so callers can replace the fabricated
 *      stage message with an honest one.
 */

import { renderHook, act } from '@testing-library/react';
import { useAgentProgress, PROGRESS_CEILING, SLOW_AFTER_SECONDS } from '../useAgentProgress';

describe('useAgentProgress', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('never exceeds the ceiling, however long the agent runs', () => {
    const { result } = renderHook(() => useAgentProgress(true, false, 20));

    // Five minutes — the duration of the real stall this guards against.
    act(() => { vi.advanceTimersByTime(5 * 60 * 1000); });

    expect(result.current.progress).toBeLessThanOrEqual(PROGRESS_CEILING);
  });

  it('stays below the final-stage message thresholds used by the wizard steps', () => {
    // StepContextDocsStep fires "Finishing up..." at 80; StepGenerating "Final touches..."
    // at 85. Time alone must never reach either.
    const { result } = renderHook(() => useAgentProgress(true, false, 20));

    act(() => { vi.advanceTimersByTime(10 * 60 * 1000); });

    expect(result.current.progress).toBeLessThan(80);
  });

  it('reports isSlow only after the threshold, while still running', () => {
    const { result } = renderHook(() => useAgentProgress(true, false, 20));

    act(() => { vi.advanceTimersByTime((SLOW_AFTER_SECONDS - 5) * 1000); });
    expect(result.current.isSlow).toBe(false);

    act(() => { vi.advanceTimersByTime(10 * 1000); });
    expect(result.current.isSlow).toBe(true);
  });

  it('snaps to 100 and clears isSlow when the agent finishes', () => {
    const { result, rerender } = renderHook(
      ({ running, done }) => useAgentProgress(running, done, 20),
      { initialProps: { running: true, done: false } }
    );

    act(() => { vi.advanceTimersByTime(5 * 60 * 1000); });
    expect(result.current.isSlow).toBe(true);

    rerender({ running: false, done: true });

    expect(result.current.progress).toBe(100);
    expect(result.current.isSlow).toBe(false);
  });

  it('resets to zero when not running', () => {
    const { result, rerender } = renderHook(
      ({ running }) => useAgentProgress(running, false, 20),
      { initialProps: { running: true } }
    );

    act(() => { vi.advanceTimersByTime(60 * 1000); });
    rerender({ running: false });

    expect(result.current.progress).toBe(0);
    expect(result.current.isSlow).toBe(false);
  });
});
