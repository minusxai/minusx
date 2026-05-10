// Data analyst benchmark — edit config and datasets below, then run:
//   cd frontend && npm run benchmark:dab
//
// Datasets are auto-discovered: every `<name>_input.jsonl` in
// DAB_BENCH_BASE_DIR is paired with `<name>_connections.json`. To run a
// subset, set DAB_BENCH_DATASETS to a comma-separated list of names,
// e.g. `DAB_BENCH_DATASETS=agnews,yelp npm run benchmark:dab`.

import { readdirSync, existsSync } from 'node:fs';
import { type Tool, type TSchema } from '@mariozechner/pi-ai';
import { getModel } from '@/lib/llm/get-model';
import {
  DAB_BENCH_BASE_DIR,
  DAB_BENCH_DATASETS,
  DAB_BENCH_RERUN,
  DAB_QUESTION_TIMEOUT,
  DAB_DATASET_TIMEOUT,
  MX_API_BASE_URL,
} from '@/lib/config';
import { renderPrompt } from '@/orchestrator/prompts';
import { BENCHMARK_MAX_ROWS } from '@/agents/benchmark-analyst/connection-source';
import {
  BenchmarkAnalystAgent,
  SearchDBSchema,
  ExecuteQuery,
} from '@/agents/benchmark-analyst/benchmark-analyst';
import { runBenchmark, logHeader, logSummary } from './runner';

const tools = [
    SearchDBSchema.schema,
    ExecuteQuery.schema,
  ];

// ── Config ────────────────────────────────────────────────────

const CONFIG = {
  model: { provider: 'anthropic', model: 'claude-haiku-4-5' },
  concurrency: 10,
  promptId: 'default.system',
  promptVars: {
    agent_name: 'MinusX Benchmark Agent',
    max_steps: '40',
    allowed_viz_types: 'table',
    role: 'admin',
    schema: '',
    context: '',
    skills_catalog: '',
    home_folder: '',
    preloaded_skills: '',
  } as Record<string, string>,
  systemPromptAppend: `## Benchmark Specific Instructions and Customization
  - You are solving a benchmark task. Your goal is to analyze the questions, and give very specific answers.
  - Only tools you have access to: ${tools.map((t) => `\`${t.name}\``).join(', ')}. Don't hallucinate any other tools.
  - You DO NOT have any other existing files with questions.
  - The answer needs to be in under 200 words. This is a benchmark, a user is not reading the answer and the evaluation might be error-prone on long winded answers. Be concise and specific. Don't add any unnecessary information. Just answer the question as directly as possible.
  - **ExecuteQuery returns at most ${BENCHMARK_MAX_ROWS} rows per call.** Use SQL \`LIMIT\` / \`ORDER BY\` to choose which ${BENCHMARK_MAX_ROWS} rows you see, aggregations (\`COUNT\`, \`SUM\`, \`GROUP BY\`) to summarise large tables, and \`OFFSET\` to page through results when you need rows beyond the first ${BENCHMARK_MAX_ROWS}. The cap applies even if your query specifies a larger LIMIT.
  `
};

// ── Datasets─────────────────────────────────────────────────

const BASE = DAB_BENCH_BASE_DIR;
if (!BASE) {
  throw new Error('DAB_BENCH_BASE_DIR env variable is required (path to mxdatasets directory)');
}

// Auto-discover datasets: every `<name>_input.jsonl` in BASE is paired
// with `<name>_connections.json`. Skips inputs without a matching
// connections file. Optional DAB_BENCH_DATASETS env (comma-separated
// names) filters to a subset; useful when iterating on a single dataset.
function discoverDatasets(baseDir: string): { input: string; connections: string }[] {
  const inputSuffix = '_input.jsonl';
  const allInputs = readdirSync(baseDir).filter((f) => f.endsWith(inputSuffix));
  const filter = DAB_BENCH_DATASETS
    ? new Set(DAB_BENCH_DATASETS.split(',').map((s) => s.trim()).filter(Boolean))
    : null;
  const datasets: { input: string; connections: string }[] = [];
  for (const fileName of allInputs.sort()) {
    const name = fileName.slice(0, -inputSuffix.length);
    if (filter && !filter.has(name)) continue;
    const connectionsPath = `${baseDir}/${name}_connections.json`;
    if (!existsSync(connectionsPath)) {
      console.warn(`Skipping ${name}: no matching connections file at ${connectionsPath}`);
      continue;
    }
    datasets.push({ input: `${baseDir}/${fileName}`, connections: connectionsPath });
  }
  if (filter) {
    const matched = new Set(datasets.map((d) => d.input.slice(d.input.lastIndexOf('/') + 1, -inputSuffix.length)));
    for (const requested of filter) {
      if (!matched.has(requested)) {
        console.warn(`DAB_BENCH_DATASETS: dataset '${requested}' not found in ${baseDir}`);
      }
    }
  }
  return datasets;
}

const DATASETS = discoverDatasets(BASE);

// ── Agent (customize tools / prompt here) ─────────────────────────────────

class Agent extends BenchmarkAnalystAgent {
  static readonly tools: Tool<TSchema>[] = tools;
  static model = getModel(
    CONFIG.model.provider as never,
    CONFIG.model.model as never,
  );

  protected getSystemPrompt(): string {
    const vars: Record<string, string> = {
      connection_id: `Available connections: \n${JSON.stringify(this.context.connections ?? [])}`,
      ...CONFIG.promptVars,
    };
    const rendered = renderPrompt(CONFIG.promptId, vars);
    const prompt = CONFIG.systemPromptAppend
      ? `${rendered}\n\n${CONFIG.systemPromptAppend}`
      : rendered;
    // Dump to file for live inspection
    // const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'rendered_system_prompt.md');
    // writeFileSync(outPath, prompt);
    return prompt;
  }
}

// ── Run ───────────────────────────────────────────────────────────────────

const registrables = [SearchDBSchema, ExecuteQuery, Agent];

// Per-dataset row concurrency. Hard-capped low (3) because each in-flight
// row spawns an agent that issues many LLM calls; with multiple datasets
// running concurrently, larger values produce rate-limit retry storms
// and amplify memory pressure from result-set materialisation.
const PER_DATASET_CONCURRENCY = 3;

// Max datasets running in parallel. With PER_DATASET_CONCURRENCY=3, peak
// in-flight agents = 3 × 3 = 9 — well under typical Anthropic Haiku 4.5
// RPM limits while still being meaningfully parallel.
const MAX_PARALLEL_DATASETS = 3;

// Default timeouts. Override via DAB_QUESTION_TIMEOUT / DAB_DATASET_TIMEOUT
// (seconds). A row that hits its timeout is cancelled and dropped from
// the output JSONL — resume picks it up on the next run. A dataset that
// hits its timeout cancels its in-flight rows and stops draining its
// queue; other datasets keep running.
const DEFAULT_QUESTION_TIMEOUT_SEC = 300;   // 5 min
const DEFAULT_DATASET_TIMEOUT_SEC = 1800;   // 30 min

function parseSeconds(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const questionTimeoutSec = parseSeconds(DAB_QUESTION_TIMEOUT, DEFAULT_QUESTION_TIMEOUT_SEC);
const datasetTimeoutSec = parseSeconds(DAB_DATASET_TIMEOUT, DEFAULT_DATASET_TIMEOUT_SEC);

const rerun = DAB_BENCH_RERUN === '1' || DAB_BENCH_RERUN === 'true';
const proxied = !!MX_API_BASE_URL;

logHeader(`Data Analyst Bench  ${CONFIG.model.provider}/${CONFIG.model.model}  ${DATASETS.length} datasets`);
console.log(
  `  routing: ${proxied ? 'mxllm proxy (' + MX_API_BASE_URL + ')' : 'DIRECT to provider — set MX_API_BASE_URL to route through mxllm'}`,
);
console.log(
  `  concurrency: ${MAX_PARALLEL_DATASETS} datasets × ${PER_DATASET_CONCURRENCY} rows = ${MAX_PARALLEL_DATASETS * PER_DATASET_CONCURRENCY} agents peak${rerun ? '  rerun=on (clearing prior outputs)' : ''}`,
);
console.log(
  `  timeouts: question=${questionTimeoutSec}s, dataset=${datasetTimeoutSec}s (override via DAB_QUESTION_TIMEOUT / DAB_DATASET_TIMEOUT)`,
);

async function main() {
  const globalStart = Date.now();
  const parallel = DATASETS.length > 1;

  // Dataset-level worker pool — same shape as the row-level pool inside
  // runBenchmark (`runner.ts`). Up to MAX_PARALLEL_DATASETS run
  // concurrently; the rest queue. Each dataset's executors are scoped
  // to its agent context, so concurrent datasets don't clobber each
  // other's wiring.
  const queue = [...DATASETS];
  const results: Array<{
    rows: number;
    errors: number;
    timeouts: number;
    datasetTimedOut: boolean;
    durationMs: number;
  }> = [];
  const workers = Array.from(
    { length: Math.min(MAX_PARALLEL_DATASETS, queue.length) },
    async () => {
      while (queue.length > 0) {
        const ds = queue.shift()!;
        const result = await runBenchmark({
          input: ds.input,
          connections: ds.connections,
          agentClass: Agent,
          registrables,
          concurrency: PER_DATASET_CONCURRENCY,
          quiet: parallel,
          rerun,
          rowTimeoutMs: questionTimeoutSec * 1000,
          datasetTimeoutMs: datasetTimeoutSec * 1000,
        });
        results.push(result);
      }
    },
  );
  await Promise.all(workers);

  const totalRows = results.reduce((s, r) => s + r.rows, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors, 0);
  const totalTimeouts = results.reduce((s, r) => s + r.timeouts, 0);
  const datasetTimeouts = results.filter((r) => r.datasetTimedOut).length;

  logSummary(
    DATASETS.length,
    totalRows,
    totalErrors,
    Date.now() - globalStart,
    totalTimeouts,
    datasetTimeouts,
  );

  // Force-exit. The MongoConnector keeps its mongo client open by
  // design (closing per-call races the driver's session lifecycle —
  // see lib/connections/mongo-connector.ts comment). At benchmark CLI
  // exit time those background heartbeats / pool timers keep the event
  // loop alive, so we explicitly hard-exit. Process exit reclaims
  // sockets cleanly. Exit code 0 — partial timeouts/errors are
  // reported in the summary but don't fail the run.
  process.exit(0);
}

main();
