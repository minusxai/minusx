// Generic benchmark runner. Loads connections, runs input rows through an
// agent class with a concurrency limit, writes output JSONL.
//
// Each benchmark file (e.g. dataanalystbench.ts) defines config + agent,
// then calls runBenchmark() — this module does the rest.

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { MXAgent, RegistrableClass } from '@/orchestrator/types';
import {
  buildBenchmarkSources,
  type BenchmarkConnectionEntry,
} from '@/agents/benchmark-analyst/connection-source';
import { getNodeConnector } from '@/lib/connections';
import type { NodeConnector } from '@/lib/connections/base';
import type { ConnectionInfo } from '@/agents/benchmark-analyst/types';
import type { ConversationLog } from '@/orchestrator/types';

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
  /** Max concurrent rows (default: 1 = sequential) */
  concurrency?: number;
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
   *  JSONL (resume picks it up on the next run). 0/undefined disables. */
  rowTimeoutMs?: number;
  /** Per-dataset timeout in ms. When exceeded, all in-flight orchestrators
   *  for this dataset are cancelled and the worker pool stops draining
   *  the queue. Already-completed rows persist; the rest get retried
   *  on resume. 0/undefined disables. */
  datasetTimeoutMs?: number;
}

export interface BenchmarkResult {
  /** Position of this row in the source `_input.jsonl` (0-based). Lets
   *  the runner skip already-done rows on resume by parsing the existing
   *  `_output.jsonl` and matching on this field. */
  input_index: number;
  input: InputRow;
  /** Raw pi-ai conversation log. Saved as-is so the output file can be
   * imported as a v2 conversation (`meta.version: 2`, `content.log: <this>`)
   * and continued in the chat UI. Display-time legacy conversion happens in
   * the /benchmark viewer via `piLogToLegacy`. */
  log: ConversationLog;
  duration_ms: number;
  error?: string;
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

function renderProgress(done: number, total: number, running: number, errors: number, elapsedMs: number): void {
  if (!isTTY) return;
  process.stderr.write(`\r\x1b[K${progressLine(done, total, running, errors, elapsedMs)}`);
}

function clearLine(): void {
  if (isTTY) process.stderr.write('\r\x1b[K');
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
  datasetTimeouts = 0,
): void {
  const dur = formatDuration(totalMs);
  const errStr = totalErrors > 0 ? `  ${c.red}${totalErrors} errors${c.reset}` : '';
  const toStr = totalTimeouts > 0 ? `  ${c.yellow}${totalTimeouts} row timeouts${c.reset}` : '';
  const dsToStr = datasetTimeouts > 0 ? `  ${c.yellow}${datasetTimeouts} dataset timeouts${c.reset}` : '';
  console.log(
    `\n${c.bold}${c.magenta}▸ Done${c.reset}  ${datasets} datasets, ${totalRows} rows${errStr}${toStr}${dsToStr}  ${c.dim}${dur}${c.reset}\n`,
  );
}

// ── Runner ────────────────────────────────────────────────────────────────

export interface DatasetResult {
  rows: number;
  errors: number;
  /** Rows that were started but cancelled by row-timeout or
   *  dataset-timeout. Not persisted to the output JSONL — they'll be
   *  retried on the next resume. */
  timeouts: number;
  /** True when the dataset itself hit `datasetTimeoutMs` and was
   *  short-circuited. The dataset's output JSONL holds whatever
   *  persisted before the cut-off. */
  datasetTimedOut: boolean;
  durationMs: number;
}

export async function runBenchmark(config: BenchmarkRunConfig): Promise<DatasetResult> {
  const inputPath = path.resolve(config.input);
  const connectionsPath = path.resolve(config.connections);
  const outputPath = path.join(
    path.dirname(inputPath),
    path.basename(inputPath).replace('input', 'output'),
  );

  const label = config.label ?? path.basename(inputPath).replace(/_input\.jsonl$/, '');

  // Load connections
  const connectorsByName = new Map<string, NodeConnector>();
  const connectionInfos = new Map<string, ConnectionInfo>();
  const entries = JSON.parse(readFileSync(connectionsPath, 'utf-8')) as BenchmarkConnectionEntry[];
  for (const { name, dialect, config: connConfig, description } of entries) {
    const conn = getNodeConnector(name, dialect, connConfig as Record<string, unknown>);
    if (!conn) throw new Error(`Unknown dialect '${dialect}' for connection '${name}'`);
    connectorsByName.set(name, conn);
    connectionInfos.set(name, { name, dialect, description });
  }

  // Build per-dataset executors. We pass them through agent context (not
  // global singletons) so multiple datasets can run in parallel without
  // clobbering each other's wiring.
  const { schemaSource, sqlExecutor } = buildBenchmarkSources(
    connectorsByName,
    new Set(connectorsByName.keys()),
  );

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

  const concurrency = config.concurrency ?? 1;
  const total = inputRows.length;
  const remainingRows = inputRows
    .map((row, i) => ({ row, i }))
    .filter(({ i }) => !completedIndices.has(i));
  const skipped = total - remainingRows.length;

  const resumeNote = config.rerun
    ? `${c.yellow}rerun: clearing prior output${c.reset}`
    : skipped > 0
      ? `${c.dim}resume: skipping ${skipped}/${total} already-done${c.reset}`
      : null;
  console.log(`\n  ${c.bold}${label}${c.reset}  ${c.dim}${total} rows, concurrency=${concurrency}${c.reset}${resumeNote ? `  ${resumeNote}` : ''}`);
  console.log(`  ${c.dim}${outputPath}${c.reset}\n`);

  // Tracking
  let completed = 0;
  let running = 0;
  let errors = 0;
  let timeouts = 0;
  let datasetTimedOut = false;
  const startedAt = Date.now();

  // In-flight orchestrators — used for fast-cancel on dataset timeout.
  // Each `runRow` adds itself on start and removes on finish.
  const inFlight = new Set<Orchestrator>();

  // Tick the progress bar every 300ms while running. Disabled in quiet
  // mode (multi-dataset parallel runs interleave too many concurrent
  // progress bars to be readable).
  const tick = (isTTY && !config.quiet)
    ? setInterval(() => renderProgress(completed, total, running, errors, Date.now() - startedAt), 300)
    : null;

  async function runRow(row: InputRow, index: number): Promise<void> {
    running++;
    if (!config.quiet) renderProgress(completed, total, running, errors, Date.now() - startedAt);

    const ctx = {
      connections: row.allowed_connections
        .map((name) => connectionInfos.get(name))
        .filter((ci): ci is ConnectionInfo => !!ci),
      schemaSource,
      sqlExecutor,
    };
    const orch = new Orchestrator(config.registrables);
    const agent = new config.agentClass(orch, { userMessage: row.user_message }, ctx);
    inFlight.add(orch);

    // Per-row timeout: when it fires, cancel the orchestrator (which
    // aborts pi-ai's stream) and flag this row as cancelled. The row's
    // own `try/catch` catches the abort error, but we discriminate via
    // the `rowCancelled` flag below so we can mark it timeout vs. error.
    let rowCancelled = false;
    const rowTimeoutMs = config.rowTimeoutMs ?? 0;
    const rowTimeoutHandle = rowTimeoutMs > 0
      ? setTimeout(() => {
        rowCancelled = true;
        orch.cancel();
      }, rowTimeoutMs)
      : null;

    const rowStart = Date.now();
    let error: string | undefined;
    try {
      // RegistrableClass types `new` as → MXTool; the caller guarantees an
      // MXAgent subclass via `agentClass`.
      const stream = orch.run(agent as unknown as MXAgent);
      for await (const _ of stream) { /* drain */ }
      await stream.result();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (rowTimeoutHandle) clearTimeout(rowTimeoutHandle);
      inFlight.delete(orch);
    }

    const durationMs = Date.now() - rowStart;
    running--;

    // Cancellation paths (row-timeout self-cancel OR dataset-timeout
    // external cancel) → don't persist; row will be retried on resume.
    const cancelled = rowCancelled || datasetTimedOut;
    if (cancelled) {
      timeouts++;
      const idx = `${c.dim}${String(index + 1).padStart(String(total).length)}/${total}${c.reset}`;
      const labelPrefix = config.quiet ? `${c.cyan}${label}${c.reset}  ` : '';
      const msg = row.user_message.slice(0, 65) + (row.user_message.length > 65 ? '…' : '');
      const dur = `${c.dim}${formatDuration(durationMs)}${c.reset}`;
      const reason = rowCancelled ? `TIMEOUT after ${formatDuration(rowTimeoutMs)}` : 'CANCELLED (dataset timeout)';
      if (!config.quiet) clearLine();
      console.log(`  ${c.yellow}⏱${c.reset} ${labelPrefix}${idx}  ${msg}  ${dur}  ${c.yellow}${reason}${c.reset}`);
      if (!config.quiet) renderProgress(completed, total, running, errors, Date.now() - startedAt);
      return;
    }

    completed++;
    if (error) errors++;

    const result: BenchmarkResult = {
      input_index: index,
      input: row,
      log: orch.log as ConversationLog,
      duration_ms: durationMs,
      error,
    };
    appendFileSync(outputPath, JSON.stringify(result) + '\n');

    // Log completion above the progress bar
    if (!config.quiet) clearLine();
    const icon = error ? `${c.red}✗${c.reset}` : `${c.green}✓${c.reset}`;
    const idx = `${c.dim}${String(index + 1).padStart(String(total).length)}/${total}${c.reset}`;
    // In quiet (parallel) mode the dataset label prefixes the row line so
    // interleaved completions from different datasets are distinguishable.
    const labelPrefix = config.quiet ? `${c.cyan}${label}${c.reset}  ` : '';
    const msg = row.user_message.slice(0, 65) + (row.user_message.length > 65 ? '…' : '');
    const dur = `${c.dim}${formatDuration(durationMs)}${c.reset}`;
    const errMsg = error ? `  ${c.red}${error.slice(0, 60)}${c.reset}` : '';
    console.log(`  ${icon} ${labelPrefix}${idx}  ${msg}  ${dur}${errMsg}`);
    if (!config.quiet) renderProgress(completed, total, running, errors, Date.now() - startedAt);
  }

  // Dataset-level timeout: when it fires, flag and cancel all in-flight
  // orchestrators. Workers also check `datasetTimedOut` at the top of
  // their loop so the queue stops draining.
  const datasetTimeoutMs = config.datasetTimeoutMs ?? 0;
  const datasetTimeoutHandle = datasetTimeoutMs > 0
    ? setTimeout(() => {
      datasetTimedOut = true;
      for (const orch of inFlight) orch.cancel();
    }, datasetTimeoutMs)
    : null;

  // Simple concurrency pool — only over the not-yet-completed rows.
  const queue = [...remainingRows];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0 && !datasetTimedOut) {
      const item = queue.shift()!;
      await runRow(item.row, item.i);
    }
  });
  await Promise.all(workers);

  if (datasetTimeoutHandle) clearTimeout(datasetTimeoutHandle);
  if (tick) clearInterval(tick);
  const totalMs = Date.now() - startedAt;

  if (datasetTimedOut) {
    if (!config.quiet) clearLine();
    console.log(`  ${c.yellow}⏱ ${c.bold}${label}${c.reset} ${c.yellow}DATASET TIMEOUT after ${formatDuration(datasetTimeoutMs)}${c.reset} — ${queue.length} rows skipped, will retry on resume`);
  }

  if (!config.quiet) {
    // Render final progress bar (stays visible)
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
  return { rows: completed, errors, timeouts, datasetTimedOut, durationMs: totalMs };
}

export { type ConnectionInfo };
