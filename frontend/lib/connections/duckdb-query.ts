import 'server-only';
import type { DuckDBConnection } from '@duckdb/node-api';

type DuckDBRunResult = Awaited<ReturnType<DuckDBConnection['run']>>;

/**
 * Run a query on a DuckDB connection with a best-effort statement timeout.
 *
 * DuckDB has no `statement_timeout` GUC, so we arm a timer that calls
 * `conn.interrupt()` — that rejects the in-flight `conn.run()` promise.
 * The timer is cleared on completion (success or failure) so it never
 * fires against a later query on the same connection. An interrupt-caused
 * rejection is normalised into a clear "exceeded the Ns timeout" error so
 * callers (and the LLM) get an actionable signal rather than a raw
 * "INTERRUPT" string.
 *
 * `timeoutMs` of 0 / undefined disables the timer — the query runs
 * unbounded, identical to a plain `conn.run()`.
 *
 * Shared by `DuckDbConnector`, `SqliteConnector` (DuckDB underneath), and
 * the benchmark `BenchmarkSharedDuckdb` — one interrupt implementation,
 * three call sites.
 */
export async function runDuckDbWithTimeout(
  conn: DuckDBConnection,
  sql: string,
  timeoutMs?: number,
  values?: unknown[],
): Promise<DuckDBRunResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // `settled` guards the timer callback: once the query has resolved (or
  // rejected), `interrupt()` must NOT be called — the connection is about
  // to be torn down by the caller, and `interrupt()` racing with
  // connection teardown is a native double-free. `clearTimeout` should
  // already prevent the callback from running, but for a native crash
  // path the belt-and-suspenders check is worth its near-zero cost.
  let settled = false;
  if (timeoutMs && timeoutMs > 0) {
    timer = setTimeout(() => {
      if (!settled) conn.interrupt();
    }, timeoutMs);
  }
  try {
    return values !== undefined
      ? await conn.run(sql, values as never)
      : await conn.run(sql);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (timer && /interrupt/i.test(msg)) {
      throw new Error(
        `Query exceeded the ${Math.round(timeoutMs! / 1000)}s timeout and was cancelled.`,
      );
    }
    throw err;
  } finally {
    settled = true;
    if (timer) clearTimeout(timer);
  }
}
