// Benchmark connection JSON normalisers. Used by the CLI runner
// (`benchmarks/runner.ts`) and the v=2 chat continuation path
// (`lib/chat-orchestration-v2.server.ts`) to load
// `<dataset>_connections.json` / `meta.benchmark_connections` /
// `BENCHMARK_CONNECTIONS_CONFIG` blobs into `ConnectionInfo[]` for
// `BenchmarkAnalystContext.connections`.
//
// `BenchmarkConnectionEntry` is just a `ConnectionInfo` with `config`
// narrowed to required — an array of them is directly assignable to
// `ConnectionInfo[]`, no conversion helper needed. Connector
// instantiation happens lazily inside the tool
// (`BaseExecuteQuery._initialiseConnectors`); this module only handles
// the JSON-shape side.
import 'server-only';
import type { ConnectionInfo } from './types';

/** A `ConnectionInfo` with `config` required — the shape stored on
 *  disk in `<dataset>_connections.json` and on a conversation file's
 *  `meta.benchmark_connections`. */
export type BenchmarkConnectionEntry = ConnectionInfo & {
  config: Record<string, unknown>;
};

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
