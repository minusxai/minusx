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
  DAB_TIMES_RUN,
  MAX_LLM_CONCURRENCY,
  MX_API_BASE_URL,
} from '@/lib/config';
import { renderPrompt } from '@/orchestrator/prompts';
import { DEFAULT_LIMIT, MAX_LIMIT } from '@/lib/sql/limit-enforcer';
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
  model: { provider: 'anthropic', model: 'claude-sonnet-4-6', "options":{"reasoning":"low"}},
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
  - **ExecuteQuery returns at most ${DEFAULT_LIMIT} rows per call when no LIMIT is specified, and clamps explicit LIMITs above ${MAX_LIMIT}.** Use SQL \`LIMIT\` / \`ORDER BY\` to control which rows you see, aggregations (\`COUNT\`, \`SUM\`, \`GROUP BY\`) to summarise large tables, and \`OFFSET\` to page through results.
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
    // const vars: Record<string, string> = {
    //   connection_id: `Available connections: \n${JSON.stringify(this.context.connections ?? [])}`,
    //   ...CONFIG.promptVars,
    // };
    // const rendered = renderPrompt(CONFIG.promptId, vars);
    // const prompt = CONFIG.systemPromptAppend
    //   ? `${rendered}\n\n${CONFIG.systemPromptAppend}`
    //   : rendered;

    const prompt = `
    You are ${CONFIG.promptVars.agent_name}, an expert data analyst agent. Your task is to analyze the questions, and give very specific answers.
    You have access to the following tools: ${tools.map((t) => `\`${t.name}\``).join(', ')}.

    Connections available to you: \n${JSON.stringify(this.context.connections ?? [])}

    ## Analysis guidelines:
      - Carefully consider the question and the data connections you have access to.
      - Search Database Schema tool to explore the structure of the databases (tables, columns, data types, etc). NEVER hallucinate table or column names.
      - Outline your approach in 1-2 sentences before executing any SQL queries.
      - Execute queries in the SQL dialect of the connected databases using the Execute SQL tool. Fix any syntax errors and try again until you get a valid response. NEVER hallucinate SQL syntax.
      - Be concise, specific and accurate.
    
    ## Response Format [EXTREMELY IMPORTANT]:
    - This is only applicable to the final answer you give at the end of your analysis, not to any intermediate reasoning or tool calls.
    - Only the first 30 words of your final response will be evaluated by an eval function, so make sure to put the most important information at the beginning that directly and fully answers the question. Lead with the answer, then explain (text, tables, etc.) if necessary. 
    - Format: 
        TL;DR: <your concise answer to the question, based on the data and your analysis>
        Analysis: <a description of your analysis, general discussion about the results, and continuation question for the user to investigate further.>
    Example:
    Q: What is the total revenue for product X in the last quarter?
    Agent:
    <Runs tools to analyze the data, arrives at the answer>
    TL;DR: $123,456 was the total revenue for product X in the last quarter.
    Analysis: <markdown table showing revenue by month>. The revenue over quarter-over-quarter has grown by 20%, with the highest revenue in March. Would you like to see a breakdown by region or customer segment?

    ## Data Documentation:
    ${this.context.contextDocs ?? 'No documentation available.'}
    `
    // console.log('--- System prompt ---');
    // console.log(prompt);
    // console.log('--- End system prompt ---');
    return prompt;
  }
}

// ── Run ───────────────────────────────────────────────────────────────────

const registrables = [SearchDBSchema, ExecuteQuery, Agent];

// Default timeouts. Override via DAB_QUESTION_TIMEOUT / DAB_DATASET_TIMEOUT
// (seconds). A row that hits its timeout is cancelled and dropped from
// the output JSONL — resume picks it up on the next run. A dataset that
// hits its timeout cancels its in-flight rows; other datasets keep running.
//
// Concurrency is now governed solely by the global `MAX_LLM_CONCURRENCY`
// env var (read inside the Orchestrator's `callLLM`). Every dataset and
// every row dispatches eagerly; agents queue at the LLM gate until their
// turn comes up. The previous `PER_DATASET_CONCURRENCY` × `MAX_PARALLEL_DATASETS`
// knobs were redundant once the LLM-level cap landed.
const DEFAULT_QUESTION_TIMEOUT_SEC = 300;   // 5 min
const DEFAULT_DATASET_TIMEOUT_SEC = 1800;   // 30 min

function parseSeconds(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const questionTimeoutSec = parseSeconds(DAB_QUESTION_TIMEOUT, DEFAULT_QUESTION_TIMEOUT_SEC);
const datasetTimeoutSec = parseSeconds(DAB_DATASET_TIMEOUT, DEFAULT_DATASET_TIMEOUT_SEC);

// Repeats per input row. Default 1 = current single-run behaviour
// (output rows have `log`). With N>1, each row's agent is invoked N
// times in parallel (throttled only by the global LLM gate) and the
// output row carries `logs: ConversationLog[]` for downstream eval
// (`mxscripts/eval_output.py`) to collapse.
function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
const timesRun = parsePositiveInt(DAB_TIMES_RUN, 1);

const rerun = DAB_BENCH_RERUN === '1' || DAB_BENCH_RERUN === 'true';
const proxied = !!MX_API_BASE_URL;

const llmConcurrencyNote = MAX_LLM_CONCURRENCY
  ? `max ${MAX_LLM_CONCURRENCY} concurrent LLM calls`
  : 'unbounded (set MAX_LLM_CONCURRENCY env to cap)';

logHeader(`Data Analyst Bench  ${CONFIG.model.provider}/${CONFIG.model.model}  ${DATASETS.length} datasets`);
console.log(
  `  routing: ${proxied ? 'mxllm proxy (' + MX_API_BASE_URL + ')' : 'DIRECT to provider — set MX_API_BASE_URL to route through mxllm'}`,
);
console.log(
  `  concurrency: ${llmConcurrencyNote}; datasets/rows dispatched eagerly${rerun ? '  rerun=on (clearing prior outputs)' : ''}`,
);
console.log(
  `  timeouts: question=${questionTimeoutSec}s, dataset=${datasetTimeoutSec}s (override via DAB_QUESTION_TIMEOUT / DAB_DATASET_TIMEOUT)`,
);
if (timesRun > 1) {
  console.log(`  timesRun: ${timesRun} (each row runs ${timesRun}× in parallel; output rows carry \`logs\`)`);
}

async function main() {
  const globalStart = Date.now();
  const parallel = DATASETS.length > 1;

  // All datasets dispatch in parallel. Provider RPS is governed by
  // `MAX_LLM_CONCURRENCY` inside the Orchestrator's LLM gate; no
  // dataset-level worker pool needed.
  const results = await Promise.all(
    DATASETS.map((ds) =>
      runBenchmark({
        input: ds.input,
        connections: ds.connections,
        agentClass: Agent,
        registrables,
        quiet: parallel,
        rerun,
        rowTimeoutMs: questionTimeoutSec * 1000,
        datasetTimeoutMs: datasetTimeoutSec * 1000,
        timesRun,
      }),
    ),
  );

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
