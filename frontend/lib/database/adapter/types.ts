/**
 * Database query result with typed rows
 */
export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

/**
 * Marker wrapping an array param so adapters bind it as a NATIVE SQL array
 * (Postgres `{...}`) — for `= ANY($1)` / `$1::int[]` — instead of JSON-stringifying
 * it (which adapters do for plain arrays destined for JSONB columns). node-postgres
 * and PGLite both reject a JSON-stringified `"[...]"` in an array context with
 * "malformed array literal". Use `sqlArray(values)` at those call sites.
 */
export class SqlArray {
  /**
   * Brand for cross-bundle-safe detection. Turbopack can evaluate this module in
   * separate bundles, giving two distinct `SqlArray` classes — so `instanceof`
   * returns false for an `SqlArray` created in another bundle, leaking the raw
   * object into the DB driver (PGLite throws "src must be of type string" while
   * encoding the Bind, which poisons its single connection → cascading 08P01).
   * Detect via this brand (`isSqlArray`) instead of `instanceof`.
   */
  readonly __isSqlArray = true as const;
  constructor(public readonly values: readonly unknown[]) {}
}

/** Wrap an array param for use in `= ANY($1)` / `$1::int[]` contexts. */
export function sqlArray(values: readonly unknown[]): SqlArray {
  return new SqlArray(values);
}

/** Cross-bundle-safe `SqlArray` check. Use this, NOT `instanceof SqlArray`. */
export function isSqlArray(p: unknown): p is SqlArray {
  return typeof p === 'object' && p !== null && (p as { __isSqlArray?: unknown }).__isSqlArray === true;
}

/**
 * Transaction context - uses same interface as adapter
 */
export interface ITransactionContext {
  query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
}

/**
 * Main database adapter interface
 * All implementations must be async (even if underlying DB is sync)
 */
export interface IDatabaseAdapter {
  /**
   * Execute a parameterized query
   * @param sql SQL query with $1, $2, ... placeholders
   * @param params Array of parameter values
   * @returns Query results with typed rows
   */
  query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;

  /**
   * Execute SQL without returning results (DDL, multi-statement)
   * @param sql SQL to execute
   */
  exec(sql: string): Promise<void>;

  /**
   * Execute operations in a transaction
   * Automatically commits on success, rolls back on error
   * @param fn Transaction callback function
   */
  transaction<T>(fn: (tx: ITransactionContext) => Promise<T>): Promise<T>;

  /**
   * Close database connection
   */
  close(): Promise<void>;

  /**
   * Initialize database schema (database-specific)
   * Each adapter implements its own schema with proper syntax
   */
  initializeSchema(): Promise<void>;

  /**
   * Perform database-specific optimization/maintenance
   * PGLite: no-op. PostgreSQL: no-op (auto-vacuum handles maintenance).
   */
  optimize(): Promise<void>;

  /**
   * Emit a Postgres NOTIFY on `channel` with `payload` (the low-latency wakeup for chat streaming;
   * see docs/chat-architecture-v3.md). Payload is capped at ~8KB by Postgres — carry pointers, not
   * data. Works on both PGLite (in-process) and Postgres.
   */
  notify(channel: string, payload: string): Promise<void>;

  /**
   * Subscribe to NOTIFYs on `channel`; `onNotify` fires with each payload. Returns an unsubscribe.
   * Channel names MUST be safe identifiers (alphanumeric + underscore) — they're not parameterizable
   * in `LISTEN`. The wakeup is best-effort; correctness comes from the caller's cursor + catch-up
   * SELECT (a NOTIFY lost while nobody listens is harmless).
   */
  listen(channel: string, onNotify: (payload: string) => void): Promise<() => Promise<void>>;
}

/**
 * Database adapter configuration
 */
export interface DatabaseConfig {
  type: 'postgres' | 'pglite';

  // PostgreSQL-specific (node-postgres)
  postgresConnectionString?: string;

  // PGLite-specific
  pgDataDir?: string; // undefined = in-memory; path = filesystem-backed
}
