// Data analyst benchmark — edit config and datasets below, then run:
//   cd frontend && npm run benchmark:dab
//
// Datasets are auto-discovered: every `<name>_input.jsonl` in
// DAB_BENCH_BASE_DIR is paired with `<name>_connections.json`. To run a
// subset, set DAB_BENCH_DATASETS to a comma-separated list of names,
// e.g. `DAB_BENCH_DATASETS=agnews,yelp npm run benchmark:dab`.

import { readdirSync, existsSync } from 'node:fs';
import { getModel } from '@/lib/llm/get-model';
import {
  DAB_BENCH_BASE_DIR,
  DAB_BENCH_DATASETS,
  DAB_BENCH_RERUN,
  DAB_QUESTION_TIMEOUT,
  DAB_DATASET_TIMEOUT,
  DAB_TIMES_RUN,
  DAB_DOUBLE_CHECK,
  MAX_LLM_CONCURRENCY,
  MX_API_BASE_URL,
} from '@/lib/config';
import { BenchmarkAnalystAgent } from '@/agents/benchmark-analyst/benchmark-analyst';
import {
  ListDBConnections,
  BaseSearchDBSchema,
  BaseExecuteQuery,
} from '@/agents/benchmark-analyst/db-tools';
import {
  DoubleCheckBenchmarkAgent,
  CheckEquivalence,
} from '@/agents/benchmark-analyst/double-check-benchmark';
import { runBenchmark, logHeader, logSummary } from './runner';

// ── Config ────────────────────────────────────────────────────

const CONFIG = {
  model: { provider: 'anthropic', model: 'claude-sonnet-4-6', "options":{"reasoning":"low"}},
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

// ── Agent (customize the model here; tools + prompt come from BenchmarkAnalystAgent) ──
//
// DAB_DOUBLE_CHECK toggles cross-check mode: the root agent becomes a
// `DoubleCheckBenchmarkAgent` that spawns two `BenchmarkAnalystAgent`
// instances in parallel (dispatched as tool calls), judges via
// `CheckEquivalence`, and retries once on disagreement. ~4× sub-agent
// runs + 2 judge calls per row.

const doubleCheck = DAB_DOUBLE_CHECK === '1' || DAB_DOUBLE_CHECK === 'true';
const benchmarkModel = getModel(
  CONFIG.model.provider as never,
  CONFIG.model.model as never,
);

// Two parallel Agent subclasses — TypeScript can't infer `static schema`
// through a conditional `extends`, so we declare both and pick one.
class SingleAgent extends BenchmarkAnalystAgent {
  static model = benchmarkModel;
}
class DoubleCheckAgent extends DoubleCheckBenchmarkAgent {
  static model = benchmarkModel;
}
// Sub-agent class registered in DoubleCheck mode: needs the configured
// `benchmarkModel`, not the default fallback that `BenchmarkAnalystAgent`
// resolves at module load (faux when ANALYST_AGENT_MODEL_CONFIG is unset).
// The orchestrator looks up by `schema.name === 'BenchmarkAnalystAgent'`,
// inherited from the parent — so this subclass IS what `DoubleCheckBenchmarkAgent`
// invokes via `orch.invoke(BenchmarkAnalystAgent, …)`.
class BenchmarkAnalystAgentForDoubleCheck extends BenchmarkAnalystAgent {
  static model = benchmarkModel;
}

const RootAgent = doubleCheck ? DoubleCheckAgent : SingleAgent;

// ── Run ───────────────────────────────────────────────────────────────────

const registrables = doubleCheck
  ? [
      ListDBConnections,
      BaseSearchDBSchema,
      BaseExecuteQuery,
      BenchmarkAnalystAgentForDoubleCheck,
      CheckEquivalence,
      RootAgent,
    ]
  : [ListDBConnections, BaseSearchDBSchema, BaseExecuteQuery, RootAgent];

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
if (doubleCheck) {
  console.log(`  doubleCheck: ON (each row runs 2 analysts in parallel + 1 judge call; retry once on disagreement ⇒ ~4× LLM cost)`);
}
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
        agentClass: RootAgent,
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
