// Benchmark connection wiring helper. Replaces the inline BMSearchDBSchema /
// BMExecuteSQL subclasses in benchmark_runner.test.ts: now the production
// SearchDBSchema / ExecuteSQL tools route via the global SchemaSource /
// SqlExecutor singletons (see ./sources), and `setupBenchmarkSources` registers
// implementations that fan out to a per-name NodeConnector map and enforce a
// per-row allowlist.
import 'server-only';
import { getNodeConnector } from '@/lib/connections';
import { NodeConnector } from '@/lib/connections/base';
import {
  setSchemaSource,
  setSqlExecutor,
  type SchemaSource,
  type SqlExecutor,
} from './sources';
import type { ConnectionInfo } from './types';

export interface BenchmarkConnectionEntry {
  name: string;
  dialect: string;
  config: Record<string, unknown>;
  description?: string;
}

export interface BenchmarkConnections {
  connectorsByName: Map<string, NodeConnector>;
  connectionInfos: Map<string, ConnectionInfo>;
}

/**
 * Build a NodeConnector map from BenchmarkConnectionEntry[] (the shape of
 * `<dataset>_connections.json` and `BENCHMARK_CONNECTIONS_CONFIG`). Used
 * both at runner startup and at v=2 chat continuation time when the
 * conversation file's `meta.benchmark_connections` carries the configs.
 * Throws if any entry references an unknown dialect.
 */
export function buildConnectorsFromEntries(
  entries: BenchmarkConnectionEntry[],
): Map<string, NodeConnector> {
  const connectorsByName = new Map<string, NodeConnector>();
  for (const { name, dialect, config } of entries) {
    const c = getNodeConnector(name, dialect, config as Record<string, unknown>);
    if (!c) throw new Error(`Unknown dialect '${dialect}' for connection '${name}'`);
    connectorsByName.set(name, c);
  }
  return connectorsByName;
}

/**
 * Parse `BENCHMARK_CONNECTIONS_CONFIG` (a JSON array of {name, dialect, config,
 * description?}) into a NodeConnector map plus the public ConnectionInfo
 * metadata exposed to the LLM via ListDBConnections. Returns empty maps when
 * the env var is unset.
 */
export function loadBenchmarkConnectionsFromEnv(): BenchmarkConnections {
  // eslint-disable-next-line no-restricted-syntax -- benchmark module reads its own scoped env var directly
  const raw = process.env.BENCHMARK_CONNECTIONS_CONFIG;
  if (!raw) return { connectorsByName: new Map(), connectionInfos: new Map() };
  const entries = JSON.parse(raw) as BenchmarkConnectionEntry[];
  const connectorsByName = buildConnectorsFromEntries(entries);
  const connectionInfos = new Map<string, ConnectionInfo>();
  for (const { name, dialect, description } of entries) {
    connectionInfos.set(name, { name, dialect, description });
  }
  return { connectorsByName, connectionInfos };
}

/**
 * Cap row results at this count for benchmark runs. Prevents the agent
 * from issuing unbounded SELECTs that materialise millions of rows
 * through `better-sqlite3 .all()` (or equivalent) and OOM the JS heap.
 * Threaded into the SQL via `LIMIT` if not already present, plus a
 * post-execution slice as belt-and-suspenders.
 */
export const BENCHMARK_MAX_ROWS = 100;

/**
 * Append `LIMIT N` if the SQL doesn't already specify one. Pushes the
 * row cap into the engine — for SQL connectors the database itself
 * stops at N; for queryleaf-backed Mongo, queryleaf emits a `$limit`
 * aggregation stage so the cursor only fetches N docs. Strips a single
 * trailing `;` because some SQL dialects reject `... ; LIMIT 100`.
 *
 * Intentionally non-clamping: if the LLM specified an explicit LIMIT
 * (even one larger than N), we trust it. The post-execution slice
 * enforces the hard cap regardless.
 */
export function appendLimitIfMissing(sql: string, limit: number): string {
  const trimmed = sql.trim().replace(/;$/, '').trim();
  if (/\blimit\s+\d+\b/i.test(trimmed)) return trimmed;
  return `${trimmed} LIMIT ${limit}`;
}

/**
 * Build NodeConnector-backed SchemaSource + SqlExecutor for a benchmark
 * run, scoped to a per-run allowlist of connection names. Pure — does not
 * touch the global singletons; the caller decides whether to register
 * globally (`setupBenchmarkSources`) or inject per-conversation via the
 * agent context (v=2 chat continuation).
 */
export function buildBenchmarkSources(
  connectorsByName: Map<string, NodeConnector>,
  allowedNames: ReadonlySet<string>,
): { schemaSource: SchemaSource; sqlExecutor: SqlExecutor } {
  // Schema cache scoped to this benchmark run. Without it, every
  // SearchDBSchema call re-introspects the connector (DuckDB
  // `information_schema.columns`, SQLite `sqlite_master` + `PRAGMA
  // table_info` per table) — repeated across every row × every search.
  // The benchmark DB files don't change during a run, so memoising the
  // full schema per connector is safe. Stores the in-flight Promise so
  // concurrent first-callers don't issue duplicate introspection queries.
  const schemaPromises = new Map<string, Promise<Awaited<ReturnType<NodeConnector['getSchema']>>>>();
  const getCachedSchema = (name: string, conn: NodeConnector) => {
    const cached = schemaPromises.get(name);
    if (cached) return cached;
    const p = conn.getSchema();
    schemaPromises.set(name, p);
    return p;
  };

  const schemaSource: SchemaSource = {
    async getSchema(connection) {
      if (!allowedNames.has(connection)) {
        throw new Error(`'${connection}' is not in this agent's connections`);
      }
      const conn = connectorsByName.get(connection);
      if (!conn) throw new Error(`connector '${connection}' not loaded`);
      return getCachedSchema(connection, conn);
    },
  };
  const sqlExecutor: SqlExecutor = {
    async execute(sql, connection) {
      if (!allowedNames.has(connection)) {
        return { rows: [], error: `'${connection}' is not in this agent's connections` };
      }
      const conn = connectorsByName.get(connection);
      if (!conn) return { rows: [], error: `connector '${connection}' not loaded` };
      try {
        const cappedSql = appendLimitIfMissing(sql, BENCHMARK_MAX_ROWS);
        const result = await conn.query(cappedSql);
        // JS-side slice in case the LLM specified an explicit LIMIT > N
        // (we don't clamp the SQL itself in that case so the LLM's
        // intent is preserved in the log, but the persisted result is
        // hard-capped to N rows).
        const rows = result.rows.length > BENCHMARK_MAX_ROWS
          ? result.rows.slice(0, BENCHMARK_MAX_ROWS)
          : result.rows;
        return { rows };
      } catch (err) {
        return { rows: [], error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
  return { schemaSource, sqlExecutor };
}

/**
 * Wire the global SchemaSource/SqlExecutor singletons to the benchmark's
 * NodeConnector map. Thin wrapper over `buildBenchmarkSources` — kept for
 * the existing benchmark-runner call site that expects globals.
 */
export function setupBenchmarkSources(
  connectorsByName: Map<string, NodeConnector>,
  allowedNames: ReadonlySet<string>,
): void {
  const { schemaSource, sqlExecutor } = buildBenchmarkSources(connectorsByName, allowedNames);
  setSchemaSource(schemaSource);
  setSqlExecutor(sqlExecutor);
}
