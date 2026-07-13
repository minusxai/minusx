// Data analyst benchmark — edit config and datasets below, then run:
//   cd frontend && npm run benchmark:dab
//
// Datasets are auto-discovered: every `<name>_input.jsonl` in
// DAB_BENCH_BASE_DIR is paired with `<name>_connections.json`. To run a
// subset, set DAB_BENCH_DATASETS to a comma-separated list of names,
// e.g. `DAB_BENCH_DATASETS=agnews,yelp npm run benchmark:dab`.

import { readdirSync, existsSync } from 'node:fs';
import { getModel } from '@/orchestrator/llm';
import {
  DAB_BENCH_BASE_DIR,
  DAB_BENCH_DATASETS,
  DAB_BENCH_RERUN,
  DAB_QUESTION_TIMEOUT,
  DAB_TIMES_RUN,
  DAB_DOUBLE_CHECK,
  DAB_V2,
  DAB_ROW_INDEX,
  DAB_AUTOCTX_ONLY,
  MAX_LLM_CONCURRENCY,
  MAX_AGENTS_CONCURRENCY,
} from '@/lib/config';
import { BenchmarkAnalystAgent } from '@/agents/benchmark-analyst/benchmark-analyst';
import {
  CatalogSearchDBSchema,
  ChainedExecuteQuery,
  FuzzyMatch,
} from '@/agents/benchmark-analyst/db-tools';
import { SubmitAnswer } from '@/agents/benchmark-analyst/submit-answer';
import { ExploreDataset } from '@/agents/benchmark-analyst/explore-dataset';
import { FetchHandleV2 } from '@/agents/benchmark-analyst/v2/fetch-handle';
import {
  DoubleCheckBenchmarkAgent,
  CheckEquivalence,
} from '@/agents/benchmark-analyst/double-check-benchmark';
import {
  V2BenchmarkAnalystAgent,
  V2DoubleCheckBenchmarkAgent,
  V2_DATA_TOOLS,
} from '@/agents/benchmark-analyst/v2';
import { AutoContextAgent, SubmitSchemaInfo } from '@/agents/benchmark-analyst/v2/auto-context';
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
// DAB_V2 toggles the V2 4-tool agent: `V2BenchmarkAnalystAgent` with
// `SearchDBSchemaV2`, `ExecuteQueryV2`, `ExploreV2`, `FetchHandleV2`.
// These use a handle-based data model for better context management.
//
// DAB_DOUBLE_CHECK toggles cross-check mode: the root agent becomes a
// `DoubleCheckBenchmarkAgent` that spawns two analyst sub-agents in
// parallel (dispatched as tool calls), judges via `CheckEquivalence`, and
// retries on disagreement. ~4× sub-agent runs + 2 judge calls per row.
// The sub-agent class is selected via `DoubleCheckBenchmarkAgent`'s
// `primaryAgent`/`secondaryAgent` static fields — defaults to V1; the V2
// subclass below overrides them. The two flags compose: `DAB_V2=1
// DAB_DOUBLE_CHECK=1` runs double-check over V2 analysts.

const useV2 = DAB_V2 === '1' || DAB_V2 === 'true';
const doubleCheck = DAB_DOUBLE_CHECK === '1' || DAB_DOUBLE_CHECK === 'true';
const benchmarkModel = getModel(
  CONFIG.model.provider as never,
  CONFIG.model.model as never,
);

// Agent subclasses with the configured model
class SingleAgent extends BenchmarkAnalystAgent {
  static model = benchmarkModel;
}
class V2Agent extends V2BenchmarkAnalystAgent {
  static model = benchmarkModel;
}
class DoubleCheckAgent extends DoubleCheckBenchmarkAgent {
  static model = benchmarkModel;
}
// Sub-agent classes registered in DoubleCheck mode: each needs the
// configured `benchmarkModel`, not the fallback the parent class resolves
// at module load (faux under vitest, MinusX default otherwise). The
// orchestrator looks up by `schema.name` (inherited from the parent), so
// these subclasses ARE what `DoubleCheckBenchmarkAgent` invokes by name.
class BenchmarkAnalystAgentForDoubleCheck extends BenchmarkAnalystAgent {
  static model = benchmarkModel;
}
class V2BenchmarkAnalystAgentForDoubleCheck extends V2BenchmarkAnalystAgent {
  static model = benchmarkModel;
}
class V2DoubleCheckAgent extends V2DoubleCheckBenchmarkAgent {
  static model = benchmarkModel;
}

// Select agent based on flags. V2 and DOUBLE_CHECK compose:
//   DAB_V2=1 DAB_DOUBLE_CHECK=1 → V2 analysts inside double-check controller.
const RootAgent = useV2
  ? (doubleCheck ? V2DoubleCheckAgent : V2Agent)
  : (doubleCheck ? DoubleCheckAgent : SingleAgent);

// ── Run ───────────────────────────────────────────────────────────────────

// AutoContextAgent is spawned by BenchmarkAnalystAgent (and its V2 /
// DoubleCheck variants) at the start of every benchmark row, so every
// registrables list must include both it and the `SubmitSchemaInfo`
// finisher tool it dispatches.
const AUTO_CONTEXT_REGISTRABLES = [AutoContextAgent, SubmitSchemaInfo];

const registrables = useV2
  ? doubleCheck
    ? [
        ...V2_DATA_TOOLS,
        V2BenchmarkAnalystAgentForDoubleCheck,
        CheckEquivalence,
        RootAgent,
        ...AUTO_CONTEXT_REGISTRABLES,
      ]
    : [...V2_DATA_TOOLS, RootAgent, ...AUTO_CONTEXT_REGISTRABLES]
  : doubleCheck
    ? [
        CatalogSearchDBSchema,
        ChainedExecuteQuery,
        FetchHandleV2,
        BenchmarkAnalystAgentForDoubleCheck,
        CheckEquivalence,
        RootAgent,
        FuzzyMatch,
        ExploreDataset,
        SubmitAnswer,
        ...AUTO_CONTEXT_REGISTRABLES,
      ]
    : [
        CatalogSearchDBSchema,
        ChainedExecuteQuery,
        FetchHandleV2,
        RootAgent,
        FuzzyMatch,
        ExploreDataset,
        SubmitAnswer,
        ...AUTO_CONTEXT_REGISTRABLES,
      ];

// Default per-question timeout (seconds). Override via DAB_QUESTION_TIMEOUT.
// A row that hits its timeout is cancelled and dropped from the output
// JSONL — resume picks it up on the next run. The timer is armed AFTER
// the row acquires its `MAX_AGENTS_CONCURRENCY` slot in the runner, so
// queue-wait under high contention does not consume timeout budget.
//
// Concurrency stacks two independent throttles:
//   - `MAX_AGENTS_CONCURRENCY` — caps simultaneous orchestrator runs
//     (gates the per-row timeout too).
//   - `MAX_LLM_CONCURRENCY` — caps in-flight provider calls (inside
//     `callLLM`'s semaphore). Set `MAX_AGENTS_CONCURRENCY ≤ MAX_LLM_CONCURRENCY`
//     for negligible LLM-slot contention within an active row.
const DEFAULT_QUESTION_TIMEOUT_SEC = 300;   // 5 min

function parseSeconds(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const questionTimeoutSec = parseSeconds(DAB_QUESTION_TIMEOUT, DEFAULT_QUESTION_TIMEOUT_SEC);

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

// Optional row filter: DAB_ROW_INDEX=1 runs only the 2nd question (0-based).
// Supports comma-separated indices and ranges: DAB_ROW_INDEX=0,2,5-7
const rowIndices: Set<number> | undefined = (() => {
  if (!DAB_ROW_INDEX) return undefined;
  // eslint-disable-next-line no-restricted-syntax -- CLI-only; not a request-scoped module
  const indices = new Set<number>();
  for (const part of DAB_ROW_INDEX.split(',')) {
    const trimmed = part.trim();
    const range = trimmed.match(/^(\d+)-(\d+)$/);
    if (range) {
      const [, lo, hi] = range;
      for (let i = Number(lo); i <= Number(hi); i++) indices.add(i);
    } else {
      const n = Number(trimmed);
      if (Number.isInteger(n) && n >= 0) indices.add(n);
    }
  }
  return indices.size > 0 ? indices : undefined;
})();
const agentsConcurrencyNote = MAX_AGENTS_CONCURRENCY
  ? `max ${MAX_AGENTS_CONCURRENCY} concurrent agent runs`
  : 'unbounded agent runs (set MAX_AGENTS_CONCURRENCY env to cap)';
const llmConcurrencyNote = MAX_LLM_CONCURRENCY
  ? `max ${MAX_LLM_CONCURRENCY} concurrent LLM calls`
  : 'unbounded LLM calls (set MAX_LLM_CONCURRENCY env to cap)';

logHeader(`Data Analyst Bench  ${CONFIG.model.provider}/${CONFIG.model.model}  ${DATASETS.length} datasets`);
console.log(
  `  concurrency: ${agentsConcurrencyNote}; ${llmConcurrencyNote}${rerun ? '  rerun=on (clearing prior outputs)' : ''}`,
);
console.log(
  `  timeout: question=${questionTimeoutSec}s (armed after agent-slot acquisition; override via DAB_QUESTION_TIMEOUT)`,
);
if (useV2) {
  console.log(`  v2: ON (4-tool agent: SearchDBSchema, ExecuteQuery, Explore, fetchHandle; handle-based data model)`);
}
if (doubleCheck) {
  console.log(`  doubleCheck: ON (each row runs 2 analysts in parallel + 1 judge call; retry once on disagreement ⇒ ~4× LLM cost)`);
}
if (timesRun > 1) {
  console.log(`  timesRun: ${timesRun} (each row runs ${timesRun}× in parallel; output rows carry \`logs\`)`);
}
if (rowIndices) {
  console.log(`  rowFilter: indices [${[...rowIndices].sort((a, b) => a - b).join(', ')}] (DAB_ROW_INDEX)`);
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
        timesRun,
        rowIndices,
        autoContextSlots: doubleCheck ? ['agent-a', 'agent-b'] : ['default'],
        autoContextOnly: DAB_AUTOCTX_ONLY === '1' || DAB_AUTOCTX_ONLY === 'true',
      }),
    ),
  );

  const totalRows = results.reduce((s, r) => s + r.rows, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors, 0);
  const totalTimeouts = results.reduce((s, r) => s + r.timeouts, 0);

  logSummary(
    DATASETS.length,
    totalRows,
    totalErrors,
    Date.now() - globalStart,
    totalTimeouts,
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
