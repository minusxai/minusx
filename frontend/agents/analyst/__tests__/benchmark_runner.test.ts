// Benchmark harness for AnalystAgent.
//
// Reads `input.jsonl` (sibling file, gitignored) and writes one line per row
// to `output.jsonl` containing the full conversation log. Connections come
// from `BENCHMARK_CONNECTIONS_CONFIG` (JSON env var). Model comes from
// `ANALYST_AGENT_MODEL_CONFIG` (handled by AnalystAgent itself).
//
// Behavior:
//   - input.jsonl missing/empty       → describe.skip (no-op, CI-safe)
//   - BENCHMARK_CONNECTIONS_CONFIG    → required when input populated
//   - ANALYST_AGENT_MODEL_CONFIG       → required when input populated
//
// Run with:
//   cd frontend && npm test -- benchmark_runner

import 'dotenv/config';
import { vi } from 'vitest';

// `lib/connections` transitively imports `server-only`. The orchestrator project
// doesn't have it mocked at setup level (node/ui projects do), so mock here.
vi.mock('server-only', () => ({}));

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Tool, TSchema } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext, ConnectionInfo, ToolResponse } from '@/orchestrator/types';
import { getNodeConnector } from '@/lib/connections';
import type { NodeConnector } from '@/lib/connections/base';
import {
  AnalystAgent,
  ExecuteSQL,
  ListDBConnections,
  SearchDBSchema,
} from '../analyst-agent';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INPUT_PATH = path.join(__dirname, 'input.jsonl');
const OUTPUT_PATH = path.join(__dirname, 'output.jsonl');

// ── Connection map (built once at module load when input is populated) ─────

const CONNECTIONS = new Map<string, NodeConnector>();
const CONNECTION_INFOS = new Map<string, ConnectionInfo>();

function loadConnections(): void {
  // eslint-disable-next-line no-restricted-syntax -- benchmark module reads its own scoped env var directly
  const raw = process.env.BENCHMARK_CONNECTIONS_CONFIG;
  if (!raw) return;
  const entries = JSON.parse(raw) as Array<{
    name: string;
    dialect: string;
    config: Record<string, unknown>;
    description?: string;
  }>;
  for (const { name, dialect, config, description } of entries) {
    const c = getNodeConnector(name, dialect, config);
    if (!c) throw new Error(`Unknown dialect '${dialect}' for connection '${name}'`);
    CONNECTIONS.set(name, c);
    CONNECTION_INFOS.set(name, { name, dialect, description });
  }
}

// ── Benchmark tool subclasses ──────────────────────────────────────────────

// Inherits run() from production: returns this.context.connections ?? [].
class BMListDBConnections extends ListDBConnections {}

class BMSearchDBSchema extends SearchDBSchema {
  async run(): Promise<ToolResponse> {
    const { connection, query } = this.parameters;
    if (!this.context.connections?.some((c) => c.name === connection)) {
      return {
        content: [{ type: 'text', text: `'${connection}' is not in this agent's connections` }],
        isError: true,
      };
    }
    const conn = CONNECTIONS.get(connection);
    if (!conn) {
      return {
        content: [{ type: 'text', text: `connector '${connection}' not loaded` }],
        isError: true,
      };
    }
    try {
      const schema = await conn.getSchema();
      const q = query.toLowerCase();
      const hits = schema.flatMap((s) =>
        s.tables
          .filter(
            (t) =>
              t.table.toLowerCase().includes(q) ||
              t.columns.some((col) => col.name.toLowerCase().includes(q)),
          )
          .map((t) => ({ schema: s.schema, table: t.table, columns: t.columns })),
      );
      return { content: [{ type: 'text', text: JSON.stringify(hits) }], isError: false };
    } catch (err) {
      return {
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  }
}

class BMExecuteSQL extends ExecuteSQL {
  async run(): Promise<ToolResponse> {
    const { connection, sql } = this.parameters;
    if (!this.context.connections?.some((c) => c.name === connection)) {
      return {
        content: [{ type: 'text', text: `'${connection}' is not in this agent's connections` }],
        isError: true,
      };
    }
    const conn = CONNECTIONS.get(connection);
    if (!conn) {
      return {
        content: [{ type: 'text', text: `connector '${connection}' not loaded` }],
        isError: true,
      };
    }
    try {
      const result = await conn.query(sql);
      return { content: [{ type: 'text', text: JSON.stringify(result.rows) }], isError: false };
    } catch (err) {
      return {
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  }
}

// ── Benchmark agent ────────────────────────────────────────────────────────

class BMAnalystAgent extends AnalystAgent {
  static readonly tools: Tool<TSchema>[] = [
    BMListDBConnections.schema,
    BMSearchDBSchema.schema,
    BMExecuteSQL.schema,
  ];
  // `static model` inherits from AnalystAgent (which reads ANALYST_AGENT_MODEL_CONFIG).
}

// ── Runner ─────────────────────────────────────────────────────────────────

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
  loadConnections();

  if (CONNECTIONS.size === 0) {
    describe('benchmark', () => {
      it('fails: BENCHMARK_CONNECTIONS_CONFIG required when input.jsonl is populated', () => {
        throw new Error(
          'Set BENCHMARK_CONNECTIONS_CONFIG to a JSON array of {name, dialect, config}.',
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

    const registrables = [BMListDBConnections, BMSearchDBSchema, BMExecuteSQL, BMAnalystAgent];

    describe.each(inputRows.map((row, i) => ({ row, i })))(
      'benchmark row $i',
      ({ row }) => {
        it(
          'runs against the LLM and appends to output.jsonl',
          async () => {
            const ctx: AgentContext = {
              userId: 'benchmark',
              mode: 'org',
              connections: row.allowed_connections
                .map((name) => CONNECTION_INFOS.get(name))
                .filter((c): c is ConnectionInfo => !!c),
            };
            const orch = new Orchestrator(registrables);
            const agent = new BMAnalystAgent(orch, { userMessage: row.user_message }, ctx);

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
