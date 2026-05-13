// Benchmark connection JSON normalisers. Used by the CLI runner
// (`benchmarks/runner.ts`) and the v=2 chat continuation path
// (`lib/chat-orchestration-v2.server.ts`) to turn raw
// `<dataset>_connections.json` / `meta.benchmark_connections` /
// `BENCHMARK_CONNECTIONS_CONFIG` blobs into the JSON shape that goes
// into `BenchmarkAnalystContext.connections`.
//
// Connector instantiation happens lazily inside the tool
// (`BaseExecuteQuery._initialiseConnectors`); this module only handles
// the metadata side.
import 'server-only';
import type { ConnectionInfo } from './types';

export interface BenchmarkConnectionEntry {
  name: string;
  dialect: string;
  config: Record<string, unknown>;
  description?: string;
}

/**
 * Convert raw benchmark-connection entries (from a JSON file or env var)
 * into the `ConnectionInfo[]` shape consumed by `BaseExecuteQuery` /
 * `BaseSearchDBSchema` via `BenchmarkAnalystContext.connections`. Each
 * entry includes `config` so the tool can build a NodeConnector.
 */
export function benchmarkEntriesToConnectionInfos(
  entries: BenchmarkConnectionEntry[],
): ConnectionInfo[] {
  return entries.map(({ name, dialect, config, description }) => ({
    name,
    dialect,
    description,
    config,
  }));
}

/**
 * Parse `BENCHMARK_CONNECTIONS_CONFIG` (a JSON array of {name, dialect,
 * config, description?}). Returns an empty array when the env var is
 * unset. Read directly off process.env — this is the only canonical
 * source of dev/test connection configs for the benchmark module, and
 * `lib/config.ts` doesn't carry it.
 */
export function loadBenchmarkConnectionsFromEnv(): BenchmarkConnectionEntry[] {
  // eslint-disable-next-line no-restricted-syntax -- benchmark module reads its own scoped env var directly
  const raw = process.env.BENCHMARK_CONNECTIONS_CONFIG;
  if (!raw) return [];
  return JSON.parse(raw) as BenchmarkConnectionEntry[];
}
