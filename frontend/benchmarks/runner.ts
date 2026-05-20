// Generic benchmark runner. Loads connections, runs input rows through an
// agent class with a concurrency limit, writes output JSONL.
//
// Each benchmark file (e.g. dataanalystbench.ts) defines config + agent,
// then calls runBenchmark() — this module does the rest.

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { MXAgent, RegistrableClass } from '@/orchestrator/types';
import type { BenchmarkConnectionEntry } from '@/agents/benchmark-analyst/connection-source';
import type { AutoContextAttempt, BenchmarkAnalystContext, ConnectionInfo } from '@/agents/benchmark-analyst/types';
import type { ActivityEvent, ConversationLog } from '@/orchestrator/types';
import { createSemaphore, parseConcurrencyLimit } from '@/orchestrator/concurrency';
import { runAutoContextForSlot } from '@/agents/benchmark-analyst/v2/auto-context/auto-context';

// Optional process-wide cap on concurrent agent runs (orchestrator
// instances). Set via the `MAX_AGENTS_CONCURRENCY` env var (read once
// at module load). Acquired BEFORE the per-run timeout is scheduled, so
// rows parked waiting for a slot don't burn their `DAB_QUESTION_TIMEOUT`
// budget while queued — the timer only ticks once the row is actually
// running. No-op when unset or non-positive: every row dispatches
// eagerly, gated only by `MAX_LLM_CONCURRENCY` inside the orchestrator.
// Resolve git commit once at startup so every output row carries provenance.
const GIT_COMMIT = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return undefined;
  }
})();

const agentSemaphore = createSemaphore(
  // eslint-disable-next-line no-restricted-syntax -- runner is the benchmark CLI entry path; avoid coupling to lib/config for one optional knob
  parseConcurrencyLimit(process.env.MAX_AGENTS_CONCURRENCY),
);

// Suppress Node's TLS warning emitted when NODE_TLS_REJECT_UNAUTHORIZED=0
// is set in .env (loaded before us via --env-file).
const _origEmitWarning = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  if (typeof warning === 'string' && warning.includes('NODE_TLS_REJECT_UNAUTHORIZED')) return;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return (_origEmitWarning as Function).call(process, warning, ...args);
}) as typeof process.emitWarning;

// ── Public types ──────────────────────────────────────────────────────────

export interface InputRow {
  user_message: string;
  allowed_connections: string[];
  docs?: string;
  additional_docs?: string;
}

export interface BenchmarkRunConfig {
  /** Path to input JSONL file */
  input: string;
  /** Path to connections JSON file */
  connections: string;
  /** Agent class to instantiate per row */
  agentClass: RegistrableClass;
  /** All registrables (tools + agent) for the Orchestrator */
  registrables: RegistrableClass[];
  /** Dataset label for display (derived from input path if omitted) */
  label?: string;
  /** Suppress the interval-driven progress bar. Per-row completion logs
   *  still print (with the dataset label prefix). Use this when running
   *  multiple datasets in parallel — concurrent progress bars step on
   *  each other. */
  quiet?: boolean;
  /** Force re-running every row even when the output JSONL already
   *  contains results. Default false: read the existing output (if any),
   *  collect completed `input_index` values, and skip those rows on
   *  subsequent runs so we don't re-burn LLM tokens on results we
   *  already have. Toggle from `dataanalystbench.ts` via the
   *  `DAB_BENCH_RERUN` env var. */
  rerun?: boolean;
  /** Per-row timeout in ms. When exceeded, the orchestrator is cancelled
   *  via AbortController and the row is **not persisted** to the output
   *  JSONL (resume picks it up on the next run). The timer is armed
   *  AFTER the row acquires its `MAX_AGENTS_CONCURRENCY` slot, so time
   *  spent queued for a slot does not count against this budget.
   *  0/undefined disables. */
  rowTimeoutMs?: number;
  /** Number of times to run each input row. Each run produces its own
   *  conversation log. When >1, all runs are executed in parallel and a
   *  single row is persisted with `logs: ConversationLog[]` instead of
   *  `log`. Resume is row-atomic: if any run is cancelled by row timeout,
   *  the whole row is dropped and retried on the next invocation.
   *  Default 1 (emits `log`). */
  timesRun?: number;
  /** Optional set of 0-based row indices to run. When set, only rows
   *  whose index is in this set are executed; all others are skipped.
   *  Useful for debugging a single question: `DAB_ROW_INDEX=3`. */
  rowIndices?: Set<number>;
  /** Catalog slots to run auto-context for before agent dispatch.
   *  Single-agent: `['default']`. DoubleCheck: `['agent-a', 'agent-b']`.
   *  When omitted or empty, auto-context is skipped entirely. */
  autoContextSlots?: string[];
  /** When true, run only the auto-context pre-step and exit without
   *  dispatching any agents. Useful for pre-warming the auto-context
   *  cache or debugging auto-context in isolation. */
  autoContextOnly?: boolean;
}

export interface BenchmarkResult {
  /** Position of this row in the source `_input.jsonl` (0-based). Lets
   *  the runner skip already-done rows on resume by parsing the existing
   *  `_output.jsonl` and matching on this field. */
  input_index: number;
  input: InputRow;
  /** Raw pi-ai conversation log from a single run. Emitted when
   *  `timesRun === 1` (default). Saved as-is so the output file can be
   *  imported as a v2 conversation (`meta.version: 2`, `content.log: <this>`)
   *  and continued in the chat UI. Display-time legacy conversion happens in
   *  the /benchmark viewer via `piLogToLegacy`. Mutually exclusive with
   *  `logs`. */
  log?: ConversationLog;
  /** Array of raw pi-ai conversation logs, one per run. Emitted when
   *  `timesRun > 1`. Downstream eval scripts collapse this back to
   *  a single `log` (picking the first success or fanning out failures
   *  to separate rows). Mutually exclusive with `log`. */
  logs?: ConversationLog[];
  duration_ms: number;
  error?: string;
  /** Dataset connections embedded so the /benchmark viewer can continue
   *  conversations without needing a separate connections.json drop. */
  connections?: BenchmarkConnectionEntry[];
  /** Short git commit hash at the time of the benchmark run. */
  git_commit?: string;
  /** AutoContext orientation outcome for this row. Records each
   *  auto-context slot attempt from the runner's pre-step.
   *  `summary` aggregates across attempts:
   *    - 'ok'      → at least one attempt succeeded
   *    - 'failed'  → all attempts failed
   *    - 'skipped' → all attempts skipped (production path / no datasetKey)
   *    - 'none'    → no attempts recorded (legacy / unexpected)
   *  Surfaced so the eval JSONL can distinguish "agent reasoning failed"
   *  from "AutoContext silently failed and the agent ran blind". */
  autoContext?: {
    summary: 'ok' | 'failed' | 'skipped' | 'none';
    attempts: AutoContextAttempt[];
  };
}

function summariseAutoContext(attempts: AutoContextAttempt[] | undefined): BenchmarkResult['autoContext'] {
  if (!attempts || attempts.length === 0) return { summary: 'none', attempts: [] };
  const summary: 'ok' | 'failed' | 'skipped' =
    attempts.some((a) => a.status === 'ok') ? 'ok'
    : attempts.every((a) => a.status === 'skipped') ? 'skipped'
    : 'failed';
  return { summary, attempts };
}

// ── ANSI helpers ──────────────────────────────────────────────────────────

const isTTY = process.stderr.isTTY ?? false;

const c = {
  reset:   isTTY ? '\x1b[0m'  : '',
  dim:     isTTY ? '\x1b[2m'  : '',
  bold:    isTTY ? '\x1b[1m'  : '',
  green:   isTTY ? '\x1b[32m' : '',
  red:     isTTY ? '\x1b[31m' : '',
  yellow:  isTTY ? '\x1b[33m' : '',
  cyan:    isTTY ? '\x1b[36m' : '',
  magenta: isTTY ? '\x1b[35m' : '',
  gray:    isTTY ? '\x1b[90m' : '',
};

// Row-level colors for multi-progress display (timesRun > 1).
// Cycling palette — visually distinct in both light and dark terminals.
const ROW_COLORS = isTTY
  ? ['\x1b[36m', '\x1b[32m', '\x1b[33m', '\x1b[35m', '\x1b[34m',
     '\x1b[96m', '\x1b[92m', '\x1b[93m', '\x1b[95m', '\x1b[94m']
  : Array<string>(10).fill('');
const ROW_BAR_WIDTH = 10;

// ── Progress display ──────────────────────────────────────────────────────

const BAR_WIDTH = 30;
// Braille patterns for smooth sub-character progress (each = 1/8th of a cell)
const BRAILLE_FILLS = [' ', '⡀', '⡄', '⡆', '⡇', '⣇', '⣧', '⣷', '⣿'];

function progressLine(done: number, total: number, running: number, errors: number, elapsedMs: number): string {
  const pct = total > 0 ? done / total : 0;
  const exact = pct * BAR_WIDTH;
  const full = Math.floor(exact);
  const partialIdx = Math.round((exact - full) * 8);
  const partial = full < BAR_WIDTH ? BRAILLE_FILLS[partialIdx] : '';
  const empty = BAR_WIDTH - full - (partial ? 1 : 0);
  const bar = `${c.cyan}${'⣿'.repeat(full)}${partial}${c.gray}${'⣀'.repeat(Math.max(0, empty))}${c.reset}`;
  const pctStr = `${c.bold}${Math.round(pct * 100)}%${c.reset}`;
  const elapsed = formatDuration(elapsedMs);
  const errStr = errors > 0 ? `  ${c.red}${errors} err${c.reset}` : '';
  const runStr = running > 0 ? `  ${c.yellow}⟳ ${running}${c.reset}` : '';
  return `  ${bar} ${pctStr} ${c.dim}${done}/${total}${c.reset}${runStr}${errStr}  ${c.dim}${elapsed}${c.reset}`;
}

function renderProgress(done: number, total: number, running: number, errors: number, elapsedMs: number, activity?: string): void {
  if (!isTTY) return;
  const line = progressLine(done, total, running, errors, elapsedMs);
  const actStr = activity ? `  ${c.dim}│${c.reset} ${activity}` : '';
  process.stderr.write(`\r\x1b[K${line}${actStr}`);
}

function clearLine(): void {
  if (isTTY) process.stderr.write('\r\x1b[K');
}

/**
 * Serialize an orchestrator-stream event for the per-run debug JSONL.
 * Defensive against circular references (some orchestrator events carry
 * back-pointers) and unserializable values — falls back to a placeholder
 * rather than aborting the run. Each line stays compact: an object
 * `{ts, rowIdx, runIdx, ev}` with the raw event nested as `ev`.
 */
function stringifyDebugEvent(payload: { ts: number; rowIdx: number; runIdx: number; ev: unknown }): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(payload, (_key, v) => {
      if (typeof v === 'bigint') return v.toString();
      if (v instanceof Error) return { _error: v.message, stack: v.stack };
      if (v && typeof v === 'object') {
        if (seen.has(v as object)) return '[Circular]';
        seen.add(v as object);
      }
      return v;
    });
  } catch (err) {
    return JSON.stringify({
      ts: payload.ts, rowIdx: payload.rowIdx, runIdx: payload.runIdx,
      ev: { _unserializable: err instanceof Error ? err.message : String(err) },
    });
  }
}

function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${(s % 60).toFixed(0)}s`;
}

// ── Logging ───────────────────────────────────────────────────────────────

export function logHeader(text: string): void {
  console.log(`\n${c.bold}${c.magenta}▸ ${text}${c.reset}`);
}

export function logSummary(
  datasets: number,
  totalRows: number,
  totalErrors: number,
  totalMs: number,
  totalTimeouts = 0,
): void {
  const dur = formatDuration(totalMs);
  const errStr = totalErrors > 0 ? `  ${c.red}${totalErrors} errors${c.reset}` : '';
  const toStr = totalTimeouts > 0 ? `  ${c.yellow}${totalTimeouts} row timeouts${c.reset}` : '';
  console.log(
    `\n${c.bold}${c.magenta}▸ Done${c.reset}  ${datasets} datasets, ${totalRows} rows${errStr}${toStr}  ${c.dim}${dur}${c.reset}\n`,
  );
}

// ── Runner ────────────────────────────────────────────────────────────────

export interface DatasetResult {
  rows: number;
  errors: number;
  /** Rows that were started but cancelled by the per-row timeout. Not
   *  persisted to the output JSONL — they'll be retried on the next
   *  resume. */
  timeouts: number;
  durationMs: number;
}

export async function runBenchmark(config: BenchmarkRunConfig): Promise<DatasetResult> {
  const inputPath = path.resolve(config.input);
  const connectionsPath = path.resolve(config.connections);
  const outputPath = path.join(
    path.dirname(inputPath),
    path.basename(inputPath).replace('input', 'output'),
  );
  // Sidecar for timed-out rows. They're dropped from `_output.jsonl` by
  // row-atomic persistence (so resume re-does them), but their partial
  // `orch.log`s are the only window into *what* the agent was grinding on
  // — captured here for offline analysis. Diagnostic only; never read back.
  // Per-run timestamp suffix so restarts don't clobber the prior run's
  // diagnostic dump (critical when every row times out and no output rows
  // survive to debug from).
  const runStamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
  const timeoutsPath = path.join(
    path.dirname(inputPath),
    path.basename(inputPath).replace('input', `timeouts_${runStamp}`),
  );

  const label = config.label ?? path.basename(inputPath).replace(/_input\.jsonl$/, '');

  // Load the dataset's connection configs. Each entry becomes a
  // `ConnectionInfo` (with `config`) that the agent's `Base*` DB tools
  // unpack into NodeConnectors at run-time. sqlite/duckdb connections
  // share one process-wide DuckDBInstance (one thread pool / buffer
  // cache) via `getOrCreateBenchmarkConnector` — see `shared-duckdb.ts`.
  const entries = JSON.parse(readFileSync(connectionsPath, 'utf-8')) as BenchmarkConnectionEntry[];
  // `BenchmarkConnectionEntry[]` is assignable to `ConnectionInfo[]` (the
  // former narrows `config` to required; the latter has it optional).
  const connectionsByName = new Map<string, ConnectionInfo>(entries.map((c) => [c.name, c]));

  // Load input rows
  const inputRows: InputRow[] = readFileSync(inputPath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as InputRow);

  if (inputRows.length === 0) {
    console.error(`  ${c.red}No rows in ${inputPath}${c.reset}`);
    process.exit(1);
  }

  // Resume support: if the output JSONL already exists and rerun is not
  // forced, parse it and skip rows whose `input_index` is already
  // persisted. We append (rather than truncate) so prior results survive.
  //
  // On-startup cleanup: rows lacking `input_index` predate the resume
  // mechanism (early benchmark outputs). We rewrite the file in place
  // with only indexed rows preserved. Self-healing — first run after
  // the migration cleans up automatically; subsequent runs are no-ops.
  // Force a clean slate by setting `DAB_BENCH_RERUN=1`.
  const completedIndices = new Set<number>();
  if (!config.rerun && existsSync(outputPath)) {
    const lines = readFileSync(outputPath, 'utf-8').split('\n').filter((line) => line.trim().length > 0);
    const indexed: string[] = [];
    let droppedUnindexed = 0;
    for (const line of lines) {
      try {
        const row = JSON.parse(line) as { input_index?: number };
        if (typeof row.input_index === 'number') {
          completedIndices.add(row.input_index);
          indexed.push(line);
        } else {
          droppedUnindexed++;
        }
      } catch {
        droppedUnindexed++; // malformed line — drop on cleanup pass
      }
    }
    if (droppedUnindexed > 0) {
      // Rewrite once; subsequent appends in this run go to the cleaned file.
      writeFileSync(outputPath, indexed.length > 0 ? indexed.join('\n') + '\n' : '');
      console.log(
        `  ${c.dim}cleanup: dropped ${droppedUnindexed} unindexed/malformed row${droppedUnindexed === 1 ? '' : 's'} from ${path.basename(outputPath)}${c.reset}`,
      );
    }
  } else {
    // Fresh run (or no prior output) — start with an empty file.
    writeFileSync(outputPath, '');
  }

  // Timeouts sidecar is per-run (timestamped filename). No truncation here
  // — appendFileSync below creates it lazily when the first timeout fires,
  // so a clean run leaves no file at all rather than an empty one.

  const timesRun = Math.max(1, Math.floor(config.timesRun ?? 1));
  const total = inputRows.length;
  const rowIndices = config.rowIndices;
  const remainingRows = inputRows
    .map((row, i) => ({ row, i }))
    .filter(({ i }) => !completedIndices.has(i))
    .filter(({ i }) => !rowIndices || rowIndices.has(i));
  const skipped = total - remainingRows.length;

  const resumeNote = config.rerun
    ? `${c.yellow}rerun: clearing prior output${c.reset}`
    : skipped > 0
      ? `${c.dim}resume: skipping ${skipped}/${total} already-done${c.reset}`
      : null;
  const timesRunNote = timesRun > 1 ? `, timesRun=${timesRun}` : '';
  const rowCountNote = rowIndices ? `${remainingRows.length}/${total} rows (filtered)` : `${total} rows`;
  console.log(`\n  ${c.bold}${label}${c.reset}  ${c.dim}${rowCountNote}${timesRunNote}${c.reset}${resumeNote ? `  ${resumeNote}` : ''}`);
  console.log(`  ${c.dim}${outputPath}${c.reset}\n`);

  // Tracking
  let completed = 0;
  let running = 0;
  let errors = 0;
  let timeouts = 0;
  const startedAt = Date.now();

  // ── Per-row context setup (built upfront before dispatch) ────────────
  const rowContexts = new Map<number, BenchmarkAnalystContext>();
  for (const { row, i } of remainingRows) {
    const ctx: BenchmarkAnalystContext = {
      connections: row.allowed_connections
        .map((name) => connectionsByName.get(name))
        .filter((c): c is ConnectionInfo => !!c),
      contextDocs: [row.docs, row.additional_docs,
        "NOTE: Pay very close attention to the provided docs above (especially the HINTS). This is critical to understanding and solving the user question correctly."
      ].filter(Boolean).join('\n\n') || undefined,
      // Carried so V2 tool helpers (e.g. `runPromptPass`) can read it
      // directly off the context — no need for tools to plumb it arg-by-arg.
      // Distinct from per-round agent userMessages (DoubleCheck rotates a
      // feedback prompt as the agent's parameters.userMessage on rounds 2+).
      originalMessage: row.user_message,
      // Per-dataset namespace for the shared DuckDB instance's ATTACH
      // aliases and the catalog cache. Two parallel datasets that both
      // declare a connection named (e.g.) `metadata_database` for
      // different files used to collide on the process-wide alias; this
      // key isolates them. `label` is the dataset's input.jsonl basename
      // — unique per dataset within a benchmark process.
      datasetKey: label,
      // Pre-initialise the AutoContext attempts log on the row ctx so
      // sub-agents' pushes propagate up. The orchestrator's context-
      // override path shallow-merges `{...parentCtx, ...overrides}`,
      // which preserves the array reference — but only if the array
      // already exists. Without this pre-init, each sub-agent's lazy
      // `ctx.autoContextAttempts = []` lands on its own (override) ctx
      // object, never reaching the row-level ctx the runner reads at
      // result-write time. (Surfaced as `"summary": "none"` on every
      // row of GITHUB_REPOS output before this fix.)
      autoContextAttempts: [],
    };
    rowContexts.set(i, ctx);
  }

  // ── AutoContext pre-step ────────────────────────────────────────────────
  // Run auto-context for each configured slot before dispatching agents.
  // Results are cached to `_autoctx.jsonl` / `_autoctx_log.jsonl`; on
  // subsequent runs, loaded from file unless CLEAR_AUTOCTX is set.
  const autoContextSlots = config.autoContextSlots ?? [];
  const autoContextBySlot: Record<string, string> = {};

  if (autoContextSlots.length > 0 && remainingRows.length > 0) {
    const autoctxPath = path.join(
      path.dirname(inputPath),
      path.basename(inputPath).replace('_input.jsonl', '_autoctx.jsonl'),
    );
    const autoctxLogPath = path.join(
      path.dirname(inputPath),
      path.basename(inputPath).replace('_input.jsonl', '_autoctx_log.jsonl'),
    );
    // eslint-disable-next-line no-restricted-syntax -- benchmark CLI env var
    const clearAutoctx = !!process.env.CLEAR_AUTOCTX;
    const allConnections = [...connectionsByName.values()];

    if (!clearAutoctx && existsSync(autoctxPath)) {
      // Load from cache
      const lines = readFileSync(autoctxPath, 'utf-8').split('\n').filter((l) => l.trim());
      for (const line of lines) {
        const entry = JSON.parse(line) as { catalogKey: string; renderedText: string };
        autoContextBySlot[entry.catalogKey] = entry.renderedText;
      }
      const slotList = Object.keys(autoContextBySlot).join(', ');
      console.log(`  ${c.green}\u2713${c.reset} AutoContext  loaded from cache (${slotList})`);
    } else {
      // Run auto-context for each slot
      for (const slot of autoContextSlots) {
        const slotLabel = autoContextSlots.length > 1 ? ` ${c.dim}${slot}${c.reset}` : '';
        process.stderr.write(`  ${c.cyan}\u21BB${c.reset} AutoContext${slotLabel}  running...`);
        const t0 = Date.now();
        try {
          const result = await runAutoContextForSlot(
            allConnections, label, slot, config.registrables,
          );
          autoContextBySlot[slot] = result.renderedText;
          const dur = formatDuration(Date.now() - t0);
          clearLine();
          console.log(`  ${c.green}\u2713${c.reset} AutoContext${slotLabel}  done (${dur}, ${result.annotationCount} annotations)`);

          // Append log
          appendFileSync(autoctxLogPath, JSON.stringify({ catalogKey: slot, log: result.log }) + '\n');
        } catch (e) {
          const dur = formatDuration(Date.now() - t0);
          const msg = e instanceof Error ? e.message : String(e);
          clearLine();
          console.log(`  ${c.red}\u2717${c.reset} AutoContext${slotLabel}  failed (${dur}): ${msg}`);
        }
      }
      // Write results
      if (Object.keys(autoContextBySlot).length > 0) {
        const resultLines = Object.entries(autoContextBySlot)
          .map(([catalogKey, renderedText]) => JSON.stringify({ catalogKey, renderedText }))
          .join('\n');
        writeFileSync(autoctxPath, resultLines + '\n', 'utf-8');
        console.log(`  ${c.dim}\u2192 ${path.basename(autoctxPath)}${c.reset}`);
      }
    }
    console.log();

    // Stamp every row context with the auto-context results
    for (const ctx of rowContexts.values()) {
      ctx.autoContextBySlot = autoContextBySlot;
      // For single-slot, also set the direct field for convenience
      const slotKeys = Object.keys(autoContextBySlot);
      if (slotKeys.length === 1) {
        ctx.autoContextRendered = autoContextBySlot[slotKeys[0]];
      }
      // Record attempt status
      for (const slot of autoContextSlots) {
        ctx.autoContextAttempts!.push(
          autoContextBySlot[slot]
            ? { status: 'ok' }
            : { status: 'failed', reason: 'auto-context pre-step did not produce a result' },
        );
      }
    }

    // Early exit: run only auto-context, skip agent dispatch.
    if (config.autoContextOnly) {
      console.log(`  ${c.dim}autoContextOnly: skipping agent dispatch${c.reset}\n`);
      return { rows: 0, errors: 0, timeouts: 0, durationMs: Date.now() - startedAt };
    }
  }

  // ── Single-run executor ────────────────────────────────────────────────

  type RunOutcome =
    | { kind: 'ok'; log: ConversationLog; error?: string }
    | { kind: 'cancelled'; reason: string; log: ConversationLog };

  const rowTimeoutMs = config.rowTimeoutMs ?? 0;

  // Per-row state for collecting outcomes, tracking timing, and display.
  type RowStatus = 'waiting' | 'running' | 'done' | 'error' | 'timeout';
  const rowState = new Map<number, {
    row: InputRow;
    outcomes: RunOutcome[];
    startTime: number;
    started: boolean;
    status: RowStatus;
    durationMs: number;
    /** Counter-based activity tracking. Each key is a phase label
     *  (e.g. 'llm', 'ExecuteQuery'), value is the number of concurrent
     *  runs in that phase. Provides an accurate picture when multiple
     *  runs per row are in flight simultaneously. */
    activityCounts: Map<string, number>;
  }>();
  for (const { row, i } of remainingRows) {
    rowState.set(i, { row, outcomes: [], startTime: 0, started: false, status: 'waiting', durationMs: 0, activityCounts: new Map() });
  }

  /** Map an ActivityEvent to a display label. */
  function activityKey(ev: ActivityEvent): string {
    if (ev.phase === 'llm') return 'llm';
    return ev.name;
  }

  /** Format a row's activity counters into a compact display string.
   *  Examples: `llm`, `2×llm`, `2×llm 1×ExecuteQuery` */
  function formatActivity(counts: Map<string, number>): string {
    const parts: string[] = [];
    for (const [label, count] of counts) {
      if (count <= 0) continue;
      parts.push(count > 1 ? `${count}×${label}` : label);
    }
    return parts.join(' ');
  }

  // ── Multi-progress display (per-row bars, timesRun > 1) ──────────────
  //
  // Each question gets its own mini bar in a cycling color. Completed
  // rows show ✓/✗/⏱ instead of the bar. A summary line at the bottom
  // shows overall run/row counts. When timesRun === 1 the existing
  // single progress bar is used.
  const useMultiProgress = timesRun > 1 && isTTY && !config.quiet;
  let multiProgressHeight = 0;

  function clearMultiProgress(): void {
    if (!isTTY || multiProgressHeight === 0) return;
    process.stderr.write(`\x1b[${multiProgressHeight}A`);
    for (let i = 0; i < multiProgressHeight; i++) {
      process.stderr.write(`\x1b[K\n`);
    }
    process.stderr.write(`\x1b[${multiProgressHeight}A`);
    multiProgressHeight = 0;
  }

  // Terminal width for truncating lines to prevent wrapping artefacts.
  const termWidth = process.stderr.columns ?? 120;

  /** Strip ANSI escape sequences to measure visible character width. */
  // eslint-disable-next-line no-control-regex
  const ANSI_RE = /\x1b\[[0-9;]*m/g;
  function visibleLength(s: string): number {
    return s.replace(ANSI_RE, '').length;
  }

  /** Truncate a line to fit within `termWidth`, preserving ANSI codes
   *  at the cut point so colors don't leak. */
  function truncateLine(s: string): string {
    if (visibleLength(s) <= termWidth) return s;
    let vis = 0;
    let i = 0;
    while (i < s.length && vis < termWidth - 1) {
      if (s[i] === '\x1b') {
        const end = s.indexOf('m', i);
        if (end !== -1) { i = end + 1; continue; }
      }
      vis++;
      i++;
    }
    return s.slice(0, i) + c.reset + '\u2026';
  }

  function renderMultiProgress(): void {
    if (!useMultiProgress) return;
    clearMultiProgress();

    const lines: string[] = [];
    const idxWidth = String(total).length;
    const msgWidth = 45;

    for (const { i } of remainingRows) {
      const state = rowState.get(i)!;
      const color = ROW_COLORS[i % ROW_COLORS.length];
      const idx = String(i + 1).padStart(idxWidth);
      const rawMsg = state.row.user_message;
      const msg = rawMsg.length > msgWidth ? rawMsg.slice(0, msgWidth) + '\u2026' : rawMsg;
      const done = state.outcomes.length;

      if (state.status === 'done') {
        lines.push(`  ${color}${idx}${c.reset}  ${c.green}\u2713${c.reset}  ${done}/${timesRun}  ${c.dim}${formatDuration(state.durationMs)}  ${msg}${c.reset}`);
      } else if (state.status === 'error') {
        lines.push(`  ${color}${idx}${c.reset}  ${c.red}\u2717${c.reset}  ${done}/${timesRun}  ${c.dim}${formatDuration(state.durationMs)}  ${msg}${c.reset}`);
      } else if (state.status === 'timeout') {
        lines.push(`  ${color}${idx}${c.reset}  ${c.yellow}\u23F1${c.reset}  ${done}/${timesRun}  ${c.dim}${formatDuration(state.durationMs)}  ${msg}${c.reset}`);
      } else if (state.started) {
        const barFilled = Math.round((done / timesRun) * ROW_BAR_WIDTH);
        const bar = `${color}${'\u2588'.repeat(barFilled)}${c.gray}${'\u2591'.repeat(ROW_BAR_WIDTH - barFilled)}${c.reset}`;
        const actStr = formatActivity(state.activityCounts);
        const act = actStr ? `  ${c.yellow}${actStr}${c.reset}` : '';
        lines.push(`  ${color}${idx}${c.reset}  ${bar}  ${done}/${timesRun}${act}  ${c.dim}${msg}${c.reset}`);
      } else {
        lines.push(`  ${c.dim}${idx}  ${'\u00B7'.repeat(ROW_BAR_WIDTH)}  0/${timesRun}  ${msg}${c.reset}`);
      }
    }

    // Summary line
    const totalRuns = remainingRows.length * timesRun;
    const doneRuns = Array.from(rowState.values()).reduce((s, r) => s + r.outcomes.length, 0);
    const pct = totalRuns > 0 ? Math.round((doneRuns / totalRuns) * 100) : 0;
    const elapsed = formatDuration(Date.now() - startedAt);
    const errStr = errors > 0 ? `  ${c.red}${errors} err${c.reset}` : '';
    const toStr = timeouts > 0 ? `  ${c.yellow}${timeouts} timeout${c.reset}` : '';
    lines.push(`  ${c.dim}\u2500\u2500${c.reset}  ${c.bold}${pct}%${c.reset}  ${c.dim}${doneRuns}/${totalRuns} runs  ${completed}/${remainingRows.length} rows${c.reset}${errStr}${toStr}  ${c.dim}${elapsed}${c.reset}`);

    const truncated = lines.map(truncateLine);
    process.stderr.write(truncated.join('\n') + '\n');
    multiProgressHeight = truncated.length;
  }

  /** Build a compact activity summary for the single-progress bar.
   *  Example: `#2 llm · #3 ExecuteSQL · #4 SearchSchema` */
  function buildActivitySummary(): string | undefined {
    const parts: string[] = [];
    for (const { i } of remainingRows) {
      const state = rowState.get(i)!;
      if (state.started && state.status === 'running') {
        const actStr = formatActivity(state.activityCounts);
        if (actStr) {
          parts.push(`${c.dim}#${i + 1}${c.reset}${c.yellow} ${actStr}${c.reset}`);
        }
      }
    }
    return parts.length > 0 ? parts.join(`${c.dim} · ${c.reset}`) : undefined;
  }

  // Helpers to abstract single-bar vs multi-progress rendering.
  function clearProgressDisplay(): void {
    if (useMultiProgress) clearMultiProgress();
    else if (!config.quiet) clearLine();
  }
  function redrawProgressDisplay(): void {
    if (useMultiProgress) renderMultiProgress();
    else if (!config.quiet) renderProgress(completed, total, running, errors, Date.now() - startedAt, buildActivitySummary());
  }

  // Tick the progress display every 300ms. Disabled in quiet mode.
  const tick = (isTTY && !config.quiet)
    ? setInterval(
        useMultiProgress
          ? () => renderMultiProgress()
          : () => renderProgress(completed, total, running, errors, Date.now() - startedAt, buildActivitySummary()),
        300,
      )
    : null;

  // Render initial state for multi-progress.
  if (useMultiProgress) renderMultiProgress();

  // Debug-stream directory: one JSONL per (row, run-attempt) so a hang
  // literally stops file growth — `tail -f` shows exactly where the
  // orchestrator was when it stalled. Sibling of the output JSONL.
  // Stable folder name per dataset (no per-run timestamp) so the same
  // path is used across re-runs; the first write to each file truncates
  // so stale data from prior runs doesn't bleed in.
  const debugDir = path.join(path.dirname(outputPath), `debug_${label}`);
  let debugDirEnsured = false;
  function ensureDebugDir(): void {
    if (debugDirEnsured) return;
    try { mkdirSync(debugDir, { recursive: true }); } catch { /* ignore */ }
    debugDirEnsured = true;
  }

  async function executeSingleRun(
    row: InputRow,
    ctx: BenchmarkAnalystContext,
    rowIdx: number,
    runIdx: number,
  ): Promise<RunOutcome> {
    await agentSemaphore.acquire();
    // Acquired a slot — clear the waiting-slot counter for this run.
    const state = rowState.get(rowIdx)!;
    const ws = (state.activityCounts.get('waiting-slot') ?? 1) - 1;
    if (ws <= 0) state.activityCounts.delete('waiting-slot');
    else state.activityCounts.set('waiting-slot', ws);

    const orch = new Orchestrator(config.registrables);
    // Wire activity tracking: increment/decrement counters so the
    // progress display shows an accurate breakdown of what all
    // concurrent runs for this row are doing right now.
    orch.onActivity = (ev) => {
      // Skip agent events — they're containers for llm/tool calls and
      // would double-count (agent active + its inner llm active).
      if (ev.phase === 'agent') return;
      const rowSt = rowState.get(rowIdx);
      if (!rowSt) return;
      const key = activityKey(ev);
      const counts = rowSt.activityCounts;
      if (ev.status === 'start') {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      } else {
        const n = (counts.get(key) ?? 1) - 1;
        if (n <= 0) counts.delete(key);
        else counts.set(key, n);
      }
    };
    const agent = new config.agentClass(orch, { userMessage: row.user_message }, ctx);

    ensureDebugDir();
    const debugPath = path.join(debugDir, `row${rowIdx}_run${runIdx}.jsonl`);
    // First write truncates — re-runs of the same (row, runAttempt) cleanly
    // replace the prior file rather than stacking events on stale content.
    // All subsequent writes (events, end-marker) use `appendFileSync`.
    try {
      writeFileSync(debugPath, JSON.stringify({
        _meta: 'debug-stream-header',
        ts: Date.now(),
        runStamp,
        label,
        rowIdx,
        runIdx,
        question: row.user_message,
      }) + '\n');
    } catch { /* diagnostic-only; don't abort the run */ }

    let runCancelled = false;
    const runTimeoutHandle = rowTimeoutMs > 0
      ? setTimeout(() => {
        runCancelled = true;
        orch.cancel();
      }, rowTimeoutMs)
      : null;

    // Track how much of `orch.log` we've already flushed. The stream
    // itself only yields completed assistant messages + pending events —
    // it skips toolResults, sub-agent dispatches, LLM-call IDs, and
    // everything else that lives in `orch.log`. So we snapshot the
    // *log delta* on every yield (and once at end) to capture all of it.
    let flushedLogLen = 0;
    const flushLogDelta = (reason: string): void => {
      const log = orch.log as unknown as Array<Record<string, unknown>>;
      while (flushedLogLen < log.length) {
        const entry = log[flushedLogLen];
        const line = stringifyDebugEvent({
          ts: Date.now(), rowIdx, runIdx,
          ev: { _kind: 'log_entry', _idx: flushedLogLen, _flushReason: reason, ...entry },
        });
        try { appendFileSync(debugPath, line + '\n'); } catch { /* diagnostic-only */ }
        flushedLogLen++;
      }
    };

    let error: string | undefined;
    try {
      const stream = orch.run(agent as unknown as MXAgent);
      for await (const ev of stream) {
        // Flush any log entries that landed since the last yield
        // (toolResults, sub-agent dispatches, etc.). Then record the
        // yielded stream event itself, marked distinctly so it's easy
        // to filter from the (richer) log entries.
        flushLogDelta('pre-yield');
        try {
          const line = stringifyDebugEvent({
            ts: Date.now(), rowIdx, runIdx,
            ev: { _kind: 'stream_event', ...(ev as Record<string, unknown>) },
          });
          appendFileSync(debugPath, line + '\n');
        } catch { /* diagnostic-only */ }
      }
      flushLogDelta('end');
      await stream.result();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      try {
        appendFileSync(debugPath, JSON.stringify({
          _meta: 'debug-stream-error',
          ts: Date.now(),
          error,
        }) + '\n');
      } catch { /* ignore */ }
    } finally {
      if (runTimeoutHandle) clearTimeout(runTimeoutHandle);
      // Final flush — capture any log entries written between the last
      // yield and run completion (or error / cancel).
      try { flushLogDelta('finalize'); } catch { /* ignore */ }
      try {
        appendFileSync(debugPath, JSON.stringify({
          _meta: 'debug-stream-end',
          ts: Date.now(),
          cancelled: runCancelled,
          error: error ?? null,
          totalLogEntries: flushedLogLen,
        }) + '\n');
      } catch { /* ignore */ }
      agentSemaphore.release();
    }

    if (runCancelled) {
      return {
        kind: 'cancelled',
        reason: `TIMEOUT after ${formatDuration(rowTimeoutMs)}`,
        log: orch.log as ConversationLog,
      };
    }
    return { kind: 'ok', log: orch.log as ConversationLog, error };
  }

  // ── Round-robin dispatch ───────────────────────────────────────────────
  // Build a flat task queue interleaving rows across runs:
  //   run0: [q1, q2, q3], run1: [q1, q2, q3], ...
  // The FIFO semaphore ensures tasks execute in this deterministic order.
  // Two stacked throttles:
  //   - `MAX_AGENTS_CONCURRENCY` (in this module) caps simultaneous
  //     orchestrator runs and gates the per-row timeout.
  //   - `MAX_LLM_CONCURRENCY` (inside the Orchestrator) caps in-flight
  //     provider calls process-wide. Both default to "no cap".
  interface RunTask { rowIdx: number; runIdx: number }
  const tasks: RunTask[] = [];
  for (let runIdx = 0; runIdx < timesRun; runIdx++) {
    for (const { i } of remainingRows) {
      tasks.push({ rowIdx: i, runIdx });
    }
  }

  await Promise.all(tasks.map(async ({ rowIdx, runIdx }) => {
    const state = rowState.get(rowIdx)!;
    const ctx = rowContexts.get(rowIdx)!;

    if (!state.started) {
      state.started = true;
      state.status = 'running';
      state.startTime = Date.now();
      running++;
      redrawProgressDisplay();
    }
    // Track this run as waiting for an agent concurrency slot.
    // Decremented after agentSemaphore.acquire() returns.
    state.activityCounts.set('waiting-slot', (state.activityCounts.get('waiting-slot') ?? 0) + 1);

    const outcome = await executeSingleRun(state.row, ctx, rowIdx, runIdx);
    state.outcomes.push(outcome);

    // When all runs for this row complete, process and persist results.
    if (state.outcomes.length < timesRun) {
      redrawProgressDisplay();
      return;
    }

    const durationMs = Date.now() - state.startTime;
    state.durationMs = durationMs;
    running--;

    // Row-atomic persistence: if ANY run was cancelled (timeout),
    // drop the whole row. Resume picks it up next invocation.
    const cancelled = state.outcomes.find(
      (o): o is { kind: 'cancelled'; reason: string; log: ConversationLog } =>
        o.kind === 'cancelled',
    );
    const collectedLogs: ConversationLog[] = [];
    let firstError: string | undefined;
    for (const o of state.outcomes) {
      if (o.kind === 'ok') {
        collectedLogs.push(o.log);
        if (o.error && !firstError) firstError = o.error;
      }
    }

    if (cancelled) {
      timeouts++;
      state.status = 'timeout';
      const timeoutRow = {
        input_index: rowIdx,
        input: state.row,
        logs: state.outcomes.map((o) => o.log),
        duration_ms: durationMs,
        timed_out: true,
        reason: cancelled.reason,
        connections: entries,
      };
      appendFileSync(timeoutsPath, JSON.stringify(timeoutRow) + '\n');

      if (!useMultiProgress) {
        const idx = `${c.dim}${String(rowIdx + 1).padStart(String(total).length)}/${total}${c.reset}`;
        const labelPrefix = config.quiet ? `${c.cyan}${label}${c.reset}  ` : '';
        const msg = state.row.user_message.slice(0, 65) + (state.row.user_message.length > 65 ? '\u2026' : '');
        const dur = `${c.dim}${formatDuration(durationMs)}${c.reset}`;
        clearProgressDisplay();
        console.log(`  ${c.yellow}\u23F1${c.reset} ${labelPrefix}${idx}  ${msg}  ${dur}  ${c.yellow}${cancelled.reason}${c.reset}`);
      }
      redrawProgressDisplay();
      return;
    }

    completed++;
    if (firstError) errors++;
    state.status = firstError ? 'error' : 'done';

    // AutoContext's tool calls already live in the conversation log under
    // the `AutoContextAgent` invocation — the benchmark viewer renders
    // them as a normal sub-agent. Top-level `autoContext` summary lets
    // post-hoc analysis distinguish "AutoContext silently failed" from
    // "agent reasoning was wrong" without scanning the log.
    const result: BenchmarkResult = {
      input_index: rowIdx,
      input: state.row,
      ...(timesRun > 1
        ? { logs: collectedLogs }
        : { log: collectedLogs[0] }),
      duration_ms: durationMs,
      error: firstError,
      connections: entries,
      git_commit: GIT_COMMIT,
      autoContext: summariseAutoContext(ctx.autoContextAttempts),
    };
    appendFileSync(outputPath, JSON.stringify(result) + '\n');

    if (!useMultiProgress) {
      clearProgressDisplay();
      const icon = firstError ? `${c.red}\u2717${c.reset}` : `${c.green}\u2713${c.reset}`;
      const idx = `${c.dim}${String(rowIdx + 1).padStart(String(total).length)}/${total}${c.reset}`;
      const labelPrefix = config.quiet ? `${c.cyan}${label}${c.reset}  ` : '';
      const msg = state.row.user_message.slice(0, 65) + (state.row.user_message.length > 65 ? '\u2026' : '');
      const dur = `${c.dim}${formatDuration(durationMs)}${c.reset}`;
      const runsSuffix = timesRun > 1 ? `  ${c.dim}\u00D7${collectedLogs.length}${c.reset}` : '';
      const errMsg = firstError ? `  ${c.red}${firstError.slice(0, 60)}${c.reset}` : '';
      console.log(`  ${icon} ${labelPrefix}${idx}  ${msg}  ${dur}${runsSuffix}${errMsg}`);
    }
    redrawProgressDisplay();
  }));

  if (tick) clearInterval(tick);
  const totalMs = Date.now() - startedAt;

  if (useMultiProgress) {
    // Render final multi-progress with updated elapsed time.
    renderMultiProgress();
  } else if (!config.quiet) {
    clearLine();
    console.log(progressLine(completed, total, 0, errors, totalMs));
  } else {
    const errStr = errors > 0 ? `  ${c.red}${errors} err${c.reset}` : '';
    const toStr = timeouts > 0 ? `  ${c.yellow}${timeouts} timeout${timeouts === 1 ? '' : 's'}${c.reset}` : '';
    const skipNote = skipped > 0 ? `${c.dim} (+${skipped} skipped)${c.reset}` : '';
    console.log(`  ${c.bold}${c.cyan}${label}${c.reset}  done  ${c.dim}${completed}/${total}${c.reset}${skipNote}${errStr}${toStr}  ${c.dim}${formatDuration(totalMs)}${c.reset}`);
  }

  // `rows` = rows actually run + persisted this invocation. Timeouts
  // are returned separately so the global summary can report them.
  return { rows: completed, errors, timeouts, durationMs: totalMs };
}

export { type ConnectionInfo };
