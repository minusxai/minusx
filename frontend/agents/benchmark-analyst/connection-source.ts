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
  const connectorsByName = new Map<string, NodeConnector>();
  const connectionInfos = new Map<string, ConnectionInfo>();
  for (const { name, dialect, config, description } of entries) {
    const c = getNodeConnector(name, dialect, config as Record<string, unknown>);
    if (!c) throw new Error(`Unknown dialect '${dialect}' for connection '${name}'`);
    connectorsByName.set(name, c);
    connectionInfos.set(name, { name, dialect, description });
  }
  return { connectorsByName, connectionInfos };
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
  const schemaSource: SchemaSource = {
    async search(query, connection) {
      if (!allowedNames.has(connection)) {
        throw new Error(`'${connection}' is not in this agent's connections`);
      }
      const conn = connectorsByName.get(connection);
      if (!conn) throw new Error(`connector '${connection}' not loaded`);
      const schema = await conn.getSchema();
      const q = query.toLowerCase();
      return schema.flatMap((s) =>
        s.tables
          .filter(
            (t) =>
              t.table.toLowerCase().includes(q) ||
              t.columns.some((col) => col.name.toLowerCase().includes(q)),
          )
          .map((t) => ({ table: t.table, columns: t.columns })),
      );
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
        const result = await conn.query(sql);
        return { rows: result.rows };
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
