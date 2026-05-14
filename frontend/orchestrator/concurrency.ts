/**
 * Process-wide async semaphore primitive owned by the orchestrator
 * layer. The engine must stay app-agnostic, so generic concurrency
 * utilities live here alongside it rather than under `lib/`. Downstream
 * consumers (e.g. the benchmark runner) import from
 * `@/orchestrator/concurrency`.
 *
 * Used by:
 *  - Orchestrator's `MAX_LLM_CONCURRENCY` LLM-call gate (inside `callLLM`).
 *  - Benchmark runner's `MAX_AGENTS_CONCURRENCY` agent-run gate (around
 *    each orchestrator `run()` so queued rows don't burn their per-row
 *    timeout while parked).
 *
 * Callers parse their own env var (via `parseConcurrencyLimit`) and
 * pass the limit to `createSemaphore`. A limit of 0 (unset / non-numeric
 * / non-positive) produces a no-op semaphore — acquire/release become
 * zero cost, so unthrottled code paths pay nothing.
 */

export interface Semaphore {
  acquire(): Promise<void>;
  release(): void;
}

export function createSemaphore(limit: number): Semaphore {
  if (limit <= 0) {
    return { acquire: async () => {}, release: () => {} };
  }
  let inFlight = 0;
  const waiters: Array<() => void> = [];
  return {
    acquire: async () => {
      if (inFlight < limit) {
        inFlight++;
        return;
      }
      await new Promise<void>((resolve) => waiters.push(resolve));
      // Slot transferred from `release`; counter stays unchanged.
    },
    release: () => {
      const next = waiters.shift();
      if (next) next();
      else inFlight--;
    },
  };
}

/**
 * Parse a positive-integer concurrency limit from an env-var string.
 * Returns 0 if unset, non-numeric, or non-positive — 0 yields a no-op
 * semaphore from `createSemaphore`.
 */
export function parseConcurrencyLimit(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 0;
}
