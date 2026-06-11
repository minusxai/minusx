import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { beginNavigation, endNavigation, isNavigationPending, runOrDefer } from '../nav-progress';

describe('nav-progress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    endNavigation(); // reset module state between tests
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs work immediately when no navigation is in flight', () => {
    const fn = vi.fn();
    runOrDefer(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('defers work while a navigation is in flight and flushes on endNavigation', () => {
    const fn = vi.fn();
    beginNavigation();
    expect(isNavigationPending()).toBe(true);
    runOrDefer(fn);
    expect(fn).not.toHaveBeenCalled();

    endNavigation();
    expect(isNavigationPending()).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('flushes deferred work in FIFO order', () => {
    const order: number[] = [];
    beginNavigation();
    runOrDefer(() => order.push(1));
    runOrDefer(() => order.push(2));
    runOrDefer(() => order.push(3));
    endNavigation();
    expect(order).toEqual([1, 2, 3]);
  });

  it('auto-flushes via the safety timeout if the navigation never commits', () => {
    const fn = vi.fn();
    beginNavigation();
    runOrDefer(fn);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(isNavigationPending()).toBe(false);
  });

  it('repeated beginNavigation calls extend the safety window without losing work', () => {
    const fn = vi.fn();
    beginNavigation();
    runOrDefer(fn);
    vi.advanceTimersByTime(3000);
    beginNavigation(); // user clicked again — restart the window
    vi.advanceTimersByTime(3000);
    expect(fn).not.toHaveBeenCalled(); // 6s elapsed but window restarted at 3s
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('one throwing deferred fn does not block the rest of the flush', () => {
    const ok = vi.fn();
    beginNavigation();
    runOrDefer(() => { throw new Error('boom'); });
    runOrDefer(ok);
    endNavigation();
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
