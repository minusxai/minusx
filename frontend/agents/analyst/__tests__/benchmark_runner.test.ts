// Benchmark harness for AnalystAgent.
//
// Reads `input.jsonl` (sibling file, gitignored) and writes one line per row
// to `output.jsonl` containing the full conversation log. Connections come
// from a JSON file (--connections path) or `BENCHMARK_CONNECTIONS_CONFIG` env var.
//
// Behavior:
//   - input.jsonl missing/empty       → describe.skip (no-op, CI-safe)
//   - connections config               → required when input populated
//   - BENCHMARK_AGENT_CONFIG.model     → required when input populated
//
// Run with:
//   cd frontend && \
//     BENCHMARK_INPUT=path/to/input.jsonl \
//     BENCHMARK_CONNECTIONS=path/to/connections.json \
//     BENCHMARK_AGENT_CONFIG_FILE=path/to/agent_config.json \
//     npm test -- benchmark_runner
//
// BENCHMARK_AGENT_CONFIG (JSON):
//   - model:              {provider, model} — required, LLM to use
//   - promptId:           prompt template to render (default: 'default.system')
//   - promptVars:         overrides merged into template variables (e.g. role, context, schema)
//   - maxSteps:           override max_steps (default: 40)
//   - systemPromptAppend: free-text appended to the end of the system prompt

import 'dotenv/config';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getModel, type Tool, type TSchema } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { ToolResponse } from '@/orchestrator/types';
import type { AnalystAgentContext, ConnectionInfo, BenchmarkConnectionEntry } from '@/agents/analyst/types';
import { getNodeConnector } from '@/lib/connections';
import { NodeConnector } from '@/lib/connections/base';
import { compressQueryResult } from '@/lib/api/compress-augmented';
import {
  AnalystAgent,
  ExecuteSQL,
  ListDBConnections,
  ReadFiles,
  SearchDBSchema,
  SearchFiles,
} from '../analyst-agent';
import { renderPrompt } from '@/orchestrator/prompts';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

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

// ── Connection map (built once at module load when input is populated) ─────

const CONNECTIONS = new Map<string, NodeConnector>();
const CONNECTION_INFOS = new Map<string, ConnectionInfo>();

/**
 * Resolve connections config: --connections <file> arg takes priority,
 * then BENCHMARK_CONNECTIONS_CONFIG env var, then undefined (not present).
 */
function resolveConnectionsJson(): string | undefined {
  // eslint-disable-next-line no-restricted-syntax -- benchmark module reads its own scoped env vars directly
  const connFile = process.env.BENCHMARK_CONNECTIONS;
  if (connFile) return readFileSync(path.resolve(connFile), 'utf-8');
  // eslint-disable-next-line no-restricted-syntax -- benchmark module reads its own scoped env vars directly
  return process.env.BENCHMARK_CONNECTIONS_CONFIG;
}

function loadConnections(): void {
  const raw = resolveConnectionsJson();
  if (!raw) return;
  const entries = JSON.parse(raw) as BenchmarkConnectionEntry[];
  for (const { name, dialect, config, description } of entries) {
    const c = getNodeConnector(name, dialect, config);
    if (!c) throw new Error(`Unknown dialect '${dialect}' for connection '${name}'`);
    CONNECTIONS.set(name, c);
    CONNECTION_INFOS.set(name, { name, dialect, description });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function errorResponse(text: string): ToolResponse {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * Look up a connector by name, enforcing the per-row allowlist in
 * `ctx.connections`. Returns the `NodeConnector` on success, or an error
 * `ToolResponse` ready to return from a tool's `run()`.
 */
function resolveConnector(
  name: string,
  ctx: { connections?: ConnectionInfo[] },
): NodeConnector | ToolResponse {
  if (!ctx.connections?.some((c) => c.name === name)) {
    return errorResponse(`'${name}' is not in this agent's connections`);
  }
  const conn = CONNECTIONS.get(name);
  if (!conn) return errorResponse(`connector '${name}' not loaded`);
  return conn;
}

/** Wrap a thrown error into an isError ToolResponse. */
async function tryRun(fn: () => Promise<ToolResponse>): Promise<ToolResponse> {
  try {
    return await fn();
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : String(err));
  }
}

// ── Benchmark tool subclasses ──────────────────────────────────────────────

// Inherits run() from production: returns this.context.connections ?? [].
class BMListDBConnections extends ListDBConnections {}

class BMSearchDBSchema extends SearchDBSchema {
  async run(): Promise<ToolResponse> {
    const { connection, query } = this.parameters;
    const conn = resolveConnector(connection, this.context);
    if (!(conn instanceof NodeConnector)) return conn;

    return tryRun(async () => {
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
      // Match production SearchDBSchema output format: {success, results, queryType, tableCount}
      const totalTables = schema.reduce((n, s) => n + s.tables.length, 0);
      const result = {
        success: true,
        results: hits.map((h) => ({
          schema: h,
          score: 1,
          matchCount: 1,
          relevantResults: h.columns.map((col) => ({
            field: col.name,
            location: `${h.schema}.${h.table}`,
            snippet: col.name,
            matchType: 'column',
          })),
        })),
        queryType: 'string',
        tableCount: totalTables,
      };
      return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false };
    });
  }
}

class BMExecuteSQL extends ExecuteSQL {
  async run(): Promise<ToolResponse> {
    const { connection, sql } = this.parameters;
    const conn = resolveConnector(connection, this.context);
    if (!(conn instanceof NodeConnector)) return conn;

    return tryRun(async () => {
      const result = await conn.query(sql);
      const compressed = compressQueryResult(result);
      return {
        content: [{ type: 'text', text: JSON.stringify(compressed) }],
        // details.queryResult carries raw rows for UI rendering (not sent to LLM)
        details: { success: true, queryResult: result },
        isError: false,
      };
    });
  }
}

// ── Benchmark-level agent config ──────────────────────────────────────────
//
// `BENCHMARK_AGENT_CONFIG` (JSON env var) controls the model, prompt, and
// agent behavior for the entire benchmark run.
//
// Example:
//   BENCHMARK_AGENT_CONFIG='{"model":{"provider":"anthropic","model":"claude-sonnet-4-6"},"promptVars":{"role":"You are a junior analyst"},"maxSteps":10}'

interface BenchmarkAgentConfig {
  model?: { provider: string; model: string };
  promptId?: string;
  promptVars?: Record<string, string>;
  maxSteps?: number;
  systemPromptAppend?: string;
}

function resolveAgentConfig(): BenchmarkAgentConfig {
  // eslint-disable-next-line no-restricted-syntax -- benchmark reads its own scoped env vars directly
  const configFile = process.env.BENCHMARK_AGENT_CONFIG_FILE;
  // eslint-disable-next-line no-restricted-syntax -- benchmark reads its own scoped env vars directly
  const configInline = process.env.BENCHMARK_AGENT_CONFIG;
  const raw = configFile ? readFileSync(path.resolve(configFile), 'utf-8') : configInline;
  return raw ? JSON.parse(raw) as BenchmarkAgentConfig : {};
}

const BENCHMARK_AGENT_CONFIG = resolveAgentConfig();

// ── Benchmark agent ────────────────────────────────────────────────────────

class BMAnalystAgent extends AnalystAgent {
  static readonly tools: Tool<TSchema>[] = [
    BMListDBConnections.schema,
    BMSearchDBSchema.schema,
    BMExecuteSQL.schema,
    ReadFiles.schema,
    SearchFiles.schema,
  ];
  static model = BENCHMARK_AGENT_CONFIG.model
    ? getModel(BENCHMARK_AGENT_CONFIG.model.provider as never, BENCHMARK_AGENT_CONFIG.model.model as never)
    : AnalystAgent.model;

  protected getSystemPrompt(): string {
    const cfg = BENCHMARK_AGENT_CONFIG;
    const defaultVars: Record<string, string> = {
      agent_name: 'AnalystAgent',
      max_steps: String(cfg.maxSteps ?? 40),
      allowed_viz_types: '',
      role: '',
      schema: '',
      context: '',
      skills_catalog: '',
      connection_id: this.context.connectionId ?? '',
      home_folder: '',
      preloaded_skills: '',
    };
    const rendered = renderPrompt(cfg.promptId ?? 'default.system', {
      ...defaultVars,
      ...cfg.promptVars,
    });
    return cfg.systemPromptAppend ? `${rendered}\n\n${cfg.systemPromptAppend}` : rendered;
  }
}

// Synthesized benchmark user — full ACL via admin role + /org home folder.
const BENCHMARK_USER: EffectiveUser = {
  userId: 1,
  email: 'benchmark@example.com',
  name: 'Benchmark Runner',
  role: 'admin',
  home_folder: '/org',
  mode: 'org',
};

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
          'Pass --connections <file.json> or set BENCHMARK_CONNECTIONS_CONFIG env var.',
        );
      });
    });
  } else if (!BENCHMARK_AGENT_CONFIG.model) {
    describe('benchmark', () => {
      it('fails: BENCHMARK_AGENT_CONFIG.model required when input.jsonl is populated', () => {
        throw new Error(
          'Set BENCHMARK_AGENT_CONFIG to \'{"model":{"provider":"...","model":"..."}}\'.',
        );
      });
    });
  } else {
    // Truncate output.jsonl at run start — each run is fresh.
    writeFileSync(OUTPUT_PATH, '');

    const registrables = [
      BMListDBConnections,
      BMSearchDBSchema,
      BMExecuteSQL,
      ReadFiles,
      SearchFiles,
      BMAnalystAgent,
    ];

    describe.each(inputRows.map((row, i) => ({ row, i })))(
      'benchmark row $i',
      ({ row }) => {
        it(
          'runs against the LLM and appends to output.jsonl',
          async () => {
            const ctx: AnalystAgentContext = {
              userId: 'benchmark',
              mode: 'org',
              connections: row.allowed_connections
                .map((name) => CONNECTION_INFOS.get(name))
                .filter((c): c is ConnectionInfo => !!c),
              effectiveUser: BENCHMARK_USER,
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
