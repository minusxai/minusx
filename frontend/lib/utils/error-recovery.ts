/**
 * Auto-recovery policy for the page error boundary (app/error.tsx).
 *
 * In production the boundary used to call reset() unconditionally. For a
 * deterministic render error (bad persisted data, a bug in the loaded build)
 * that is an infinite loop: reset() re-renders the same broken tree, the
 * boundary remounts, the effect fires again — the page never recovers and the
 * tab posts a capture-error report every dedup window, forever. Crucially,
 * reset() re-runs the JS already loaded in the tab, so a stale tab can never
 * pick up a fixed deployment; only a full reload can.
 *
 * Policy per error message:
 *   1. 'reset'    — up to MAX_AUTO_RESETS occurrences within LOOP_WINDOW_MS
 *   2. 'reload'   — one hard reload, guarded via sessionStorage so a build
 *                   that is still broken after reload cannot reload-loop
 *   3. 'fallback' — stop auto-recovering; show a manual-recovery UI
 *
 * Occurrences further than LOOP_WINDOW_MS apart are sporadic, not a loop, and
 * keep auto-resetting (the long-lived-tab "occasional hiccup" case).
 */

export type RecoveryAction = 'reset' | 'reload' | 'fallback';

export const MAX_AUTO_RESETS = 2;
export const LOOP_WINDOW_MS = 5 * 60_000;
export const RELOAD_GUARD_WINDOW_MS = 10 * 60_000;

const RELOAD_GUARD_KEY = 'mx-page-error-reload';

type GuardStorage = Pick<Storage, 'getItem' | 'setItem'>;

interface RecoveryOpts {
  now?: number;
  /** Injectable for tests; defaults to window.sessionStorage when available. */
  storage?: GuardStorage;
}

// Per-page-load attempt counts; sessionStorage only guards the reload step.
// eslint-disable-next-line no-restricted-syntax -- client-side per-tab state; not shared across server requests
const attemptsByMessage = new Map<string, { count: number; lastAt: number }>();

function defaultStorage(): GuardStorage | undefined {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : undefined;
  } catch {
    return undefined; // accessing sessionStorage itself can throw (privacy mode)
  }
}

/**
 * Record the intent to hard-reload for `message`. Returns false when a reload
 * for this message is already recorded within the guard window, or when the
 * guard cannot be recorded at all (no/throwing storage) — reloading without a
 * record risks a reload loop.
 */
function tryAcquireReloadGuard(message: string, now: number, storage: GuardStorage | undefined): boolean {
  if (!storage) return false;
  try {
    const raw = storage.getItem(RELOAD_GUARD_KEY);
    if (raw) {
      const prev = JSON.parse(raw) as { message?: string; ts?: number };
      if (prev.message === message && typeof prev.ts === 'number' && now - prev.ts < RELOAD_GUARD_WINDOW_MS) {
        return false;
      }
    }
    storage.setItem(RELOAD_GUARD_KEY, JSON.stringify({ message, ts: now }));
    return true;
  } catch {
    return false;
  }
}

export function decideRecoveryAction(message: string, opts: RecoveryOpts = {}): RecoveryAction {
  const now = opts.now ?? Date.now();
  const prev = attemptsByMessage.get(message);
  const count = prev && now - prev.lastAt < LOOP_WINDOW_MS ? prev.count + 1 : 1;
  attemptsByMessage.set(message, { count, lastAt: now });

  if (count <= MAX_AUTO_RESETS) return 'reset';
  const storage = 'storage' in opts ? opts.storage : defaultStorage();
  return tryAcquireReloadGuard(message, now, storage) ? 'reload' : 'fallback';
}

/** Full page reload — fetches the current deployment instead of re-rendering stale JS. */
export function hardReload(): void {
  window.location.reload();
}
