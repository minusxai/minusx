// Benchmark harness for BenchmarkAnalystAgent.
//
// Reads `input.jsonl` (sibling file, gitignored) and writes one line per row
// to `output.jsonl` containing the full conversation log. Connections come
// from `BENCHMARK_CONNECTIONS_CONFIG` (JSON env var). Model comes from
// `ANALYST_AGENT_MODEL_CONFIG` (handled by BenchmarkAnalystAgent itself).
//
// Behavior:
//   - input.jsonl missing/empty       → describe.skip (no-op, CI-safe)
//   - connections config               → required when input populated
//   - ANALYST_AGENT_MODEL_CONFIG       → required when input populated
//
// Run with:
//   cd frontend && BENCHMARK_INPUT=path/to/input.jsonl BENCHMARK_CONNECTIONS=path/to/connections.json npm test -- benchmark_runner
//   cd frontend && BENCHMARK_CONNECTIONS_CONFIG='[...]' npm test -- benchmark_runner

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
import {
  loadBenchmarkConnectionsFromEnv,
  setupBenchmarkSources,
} from '@/agents/benchmark-analyst/connection-source';
import type {
  BenchmarkAnalystContext,
  ConnectionInfo,
} from '@/agents/benchmark-analyst/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// eslint-disable-next-line no-restricted-syntax -- benchmark reads its own scoped env vars directly
// eslint-disable-next-line no-restricted-syntax -- benchmark reads its own scoped env vars directly
const INPUT_PATH = process.env.BENCHMARK_INPUT
  ? path.resolve(process.env.BENCHMARK_INPUT)
  : path.join(__dirname, 'input.jsonl');
const OUTPUT_PATH = path.join(
  path.dirname(INPUT_PATH),
  path.basename(INPUT_PATH).replace('input', 'output'),
);

interface InputRow {
  user_message: string;
  allowed_connections: string[];
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
        throw new Error(
          'Pass --connections <file.json> or set BENCHMARK_CONNECTIONS_CONFIG env var.',
        );
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
    // Truncate output.jsonl at run start — each run is fresh.
    writeFileSync(OUTPUT_PATH, '');

    const registrables = [
      ListDBConnections,
      SearchDBSchema,
      ExecuteSQL,
      BenchmarkAnalystAgent,
    ];

    describe.each(inputRows.map((row, i) => ({ row, i })))(
      'benchmark row $i',
      ({ row }) => {
        it(
          'runs against the LLM and appends to output.jsonl',
          async () => {
            // Per-row source wiring: only the row's allowed connections are
            // resolvable. Schema/SQL routes through `connectorsByName`.
            setupBenchmarkSources(connectorsByName, new Set(row.allowed_connections));

            const ctx: BenchmarkAnalystContext = {
              connections: row.allowed_connections
                .map((name) => connectionInfos.get(name))
                .filter((c): c is ConnectionInfo => !!c),
            };
            const orch = new Orchestrator(registrables);
            const agent = new BenchmarkAnalystAgent(orch, { userMessage: row.user_message }, ctx);

            const startedAt = Date.now();
            let error: string | undefined;
            try {
              const stream = orch.run(agent);
              for await (const _ of stream) {
                /* drain */
              }
              await stream.result();
            } catch (err) {
              error = err instanceof Error ? err.message : String(err);
            }

            const outLine = JSON.stringify({
              input: row,
              log: orch.log,
              duration_ms: Date.now() - startedAt,
              error,
            });
            appendFileSync(OUTPUT_PATH, outLine + '\n');

            // We don't fail on individual run errors — the harness records them
            // in output.jsonl. CI failure conditions are at file-load gate level.
          },
          600_000,
        );
      },
    );
  }
}
