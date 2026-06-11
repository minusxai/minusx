'use client';

/**
 * Navigation churn guard.
 *
 * Next's App Router runs client navigations as a low-priority React transition.
 * On a data-heavy page (a dashboard mounting many embedded question tiles while
 * their queries stream in) the page emits a steady stream of urgent updates
 * (tile mounts, query-result dispatches). Each urgent update preempts and
 * RESTARTS the pending navigation transition, so clicking a tile title feels
 * dead until the whole dashboard settles.
 *
 * While a navigation is in flight, non-critical updates are deferred via
 * `runOrDefer` and flushed when the route commits (`endNavigation`, called from
 * LayoutWrapper's pathname effect) or after a safety timeout.
 */

let navInProgress = false;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;
const queue: Array<() => void> = [];

/** Mark the start of an in-app navigation. Safe to call repeatedly. */
export function beginNavigation(): void {
  navInProgress = true;
  if (safetyTimer) clearTimeout(safetyTimer);
  // Never strand deferred work if a navigation is cancelled / never commits.
  safetyTimer = setTimeout(endNavigation, 5000);
}

/** Mark navigation complete and flush any deferred work. */
export function endNavigation(): void {
  navInProgress = false;
  if (safetyTimer) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
  if (queue.length === 0) return;
  const pending = queue.splice(0, queue.length);
  for (const fn of pending) {
    try { fn(); } catch { /* best-effort flush */ }
  }
}

/** True while an in-app navigation is in flight. */
export function isNavigationPending(): boolean {
  return navInProgress;
}

/** Run `fn` now, or defer it until the in-flight navigation completes. */
export function runOrDefer(fn: () => void): void {
  if (navInProgress) queue.push(fn);
  else fn();
}
