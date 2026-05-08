// Benchmark harness for BenchmarkAnalystAgent.
//
// Reads `input.jsonl` (sibling file, gitignored) and writes one line per row
// to `output.jsonl` containing the full conversation log. Connections come
// from `BENCHMARK_CONNECTIONS_CONFIG` (JSON env var). Model comes from
// `ANALYST_AGENT_MODEL_CONFIG` (handled by BenchmarkAnalystAgent itself).
//
// Rows run N-at-a-time in parallel (default BENCHMARK_CONCURRENCY=4).
// Each row carries isolated SchemaSource/SqlExecutor in its context so there
// are no shared-state races between concurrent rows.
//
// Behavior:
//   - input.jsonl missing/empty       → describe.skip (no-op, CI-safe)
//   - connections config               → required when input populated
//   - ANALYST_AGENT_MODEL_CONFIG       → required when input populated
//
// Run with:
//   cd frontend && BENCHMARK_CONNECTIONS_CONFIG='[...]' npm test -- benchmark_runner
//   cd frontend && BENCHMARK_INPUT=path/to/input.jsonl BENCHMARK_CONNECTIONS_CONFIG='[...]' npm test -- benchmark_runner

import 'dotenv/config';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Orchestrator } from '@/orchestrator/orchestrator';
import {
  BenchmarkAnalystAgent,
  ListDBConnections,
  SearchDBSchema,
  ExecuteSQL,
} from '@/agents/benchmark-analyst/benchmark-analyst';
import { loadBenchmarkConnectionsFromEnv } from '@/agents/benchmark-analyst/connection-source';
import type { NodeConnector } from '@/lib/connections/base';
import type {
  BenchmarkAnalystContext,
  ConnectionInfo,
} from '@/agents/benchmark-analyst/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// eslint-disable-next-line no-restricted-syntax -- benchmark reads its own scoped env vars directly
const INPUT_PATH = process.env.BENCHMARK_INPUT
  ? path.resolve(process.env.BENCHMARK_INPUT)
  : path.join(__dirname, 'input.jsonl');
const OUTPUT_PATH = path.join(
  path.dirname(INPUT_PATH),
  path.basename(INPUT_PATH).replace('input', 'output'),
);

// eslint-disable-next-line no-restricted-syntax -- benchmark reads its own scoped env var directly
const CONCURRENCY = parseInt(process.env.BENCHMARK_CONCURRENCY ?? '4', 10);

interface InputRow {
  user_message: string;
  allowed_connections: string[];
}

/** Run tasks N-at-a-time. Order of results matches order of tasks. */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  n: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const idx = next++;
      results[idx] = await tasks[idx]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  return results;
}

/** Build a per-row isolated context — no global singleton mutation needed. */
function buildRowContext(
  connectorsByName: Map<string, NodeConnector>,
  connectionInfos: Map<string, ConnectionInfo>,
  allowedConnections: string[],
): BenchmarkAnalystContext {
  const allowedSet = new Set(allowedConnections);

  return {
    connections: allowedConnections
      .map((name) => connectionInfos.get(name))
      .filter((c): c is ConnectionInfo => !!c),

    schemaSource: {
      async search(query, connection) {
        if (!allowedSet.has(connection)) {
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
                !q ||
                t.table.toLowerCase().includes(q) ||
                t.columns.some((col) => col.name.toLowerCase().includes(q)),
            )
            .map((t) => ({ table: t.table, columns: t.columns })),
        );
      },
    },

    sqlExecutor: {
      async execute(sql, connection) {
        if (!allowedSet.has(connection)) {
          return { rows: [], error: `'${connection}' is not in this agent's connections` };
        }
        const conn = connectorsByName.get(connection);
        if (!conn) return { rows: [], error: `connector '${connection}' not loaded` };
        try {
          const result = await conn.query(sql);
          return { rows: result.rows, columns: result.columns, types: result.types };
        } catch (err) {
          return { rows: [], error: err instanceof Error ? err.message : String(err) };
        }
      },
    },
  };
}

const inputRows: InputRow[] = existsSync(INPUT_PATH)
  ? readFileSync(INPUT_PATH, 'utf-8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as InputRow)
  : [];

if (inputRows.length === 0) {
  describe.skip('benchmark', () => {
    it('skipped: no input.jsonl', () => {
      // intentionally empty — placeholder so the file is well-formed when skipped
    });
  });
} else {
  const { connectorsByName, connectionInfos } = loadBenchmarkConnectionsFromEnv();

  if (connectorsByName.size === 0) {
    describe('benchmark', () => {
      it('fails: BENCHMARK_CONNECTIONS_CONFIG required when input.jsonl is populated', () => {
        throw new Error('Set BENCHMARK_CONNECTIONS_CONFIG env var.');
      });
    });
    // eslint-disable-next-line no-restricted-syntax -- benchmark gate check, scoped to this file
  } else if (!process.env.ANALYST_AGENT_MODEL_CONFIG) {
    describe('benchmark', () => {
      it('fails: ANALYST_AGENT_MODEL_CONFIG required when input.jsonl is populated', () => {
        throw new Error('Set ANALYST_AGENT_MODEL_CONFIG to {"provider":"...","model":"..."}.');
      });
    });
  } else {
    describe('benchmark', () => {
      it(
        `runs ${inputRows.length} rows ${CONCURRENCY}-at-a-time and writes output.jsonl`,
        async () => {
          writeFileSync(OUTPUT_PATH, '');

          const registrables = [ListDBConnections, SearchDBSchema, ExecuteSQL, BenchmarkAnalystAgent];

          const tasks = inputRows.map((row, inputIndex) => async () => {
            const ctx = buildRowContext(connectorsByName, connectionInfos, row.allowed_connections);
            const orch = new Orchestrator(registrables);
            const agent = new BenchmarkAnalystAgent(orch, { userMessage: row.user_message }, ctx);

            const startedAt = Date.now();
            let error: string | undefined;
            try {
              const stream = orch.run(agent);
              for await (const _ of stream) { /* drain */ }
              await stream.result();
            } catch (err) {
              error = err instanceof Error ? err.message : String(err);
            }

            const outLine = JSON.stringify({
              input_index: inputIndex,
              log: orch.log,
              duration_ms: Date.now() - startedAt,
              ...(error ? { error } : {}),
            });
            // appendFileSync is synchronous — safe to call from concurrent tasks.
            appendFileSync(OUTPUT_PATH, outLine + '\n');
          });

          await runWithConcurrency(tasks, CONCURRENCY);
        },
        // 10-minute ceiling — generous for large benchmark sets.
        600_000,
      );
    });
  }
}
