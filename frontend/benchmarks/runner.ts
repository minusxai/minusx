// Generic benchmark runner. Loads connections, runs input rows through an
// agent class with a concurrency limit, writes output JSONL.
//
// Each benchmark file (e.g. dataanalystbench.ts) defines config + agent,
// then calls runBenchmark() — this module does the rest.

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { MXAgent, RegistrableClass } from '@/orchestrator/types';
import type { BenchmarkConnectionEntry } from '@/agents/benchmark-analyst/connection-source';
import type { BenchmarkAnalystContext, ConnectionInfo } from '@/agents/benchmark-analyst/types';
import type { ConversationLog } from '@/orchestrator/types';
import { createSemaphore, parseConcurrencyLimit } from '@/orchestrator/concurrency';

// Optional process-wide cap on concurrent agent runs (orchestrator
// instances). Set via the `MAX_AGENTS_CONCURRENCY` env var (read once
// at module load). Acquired BEFORE the per-run timeout is scheduled, so
// rows parked waiting for a slot don't burn their `DAB_QUESTION_TIMEOUT`
// budget while queued — the timer only ticks once the row is actually
// running. No-op when unset or non-positive: every row dispatches
// eagerly, gated only by `MAX_LLM_CONCURRENCY` inside the orchestrator.
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

  const timesRun = Math.max(1, Math.floor(config.timesRun ?? 1));
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
  const timesRunNote = timesRun > 1 ? `, timesRun=${timesRun}` : '';
  console.log(`\n  ${c.bold}${label}${c.reset}  ${c.dim}${total} rows${timesRunNote}${c.reset}${resumeNote ? `  ${resumeNote}` : ''}`);
  console.log(`  ${c.dim}${outputPath}${c.reset}\n`);

  // Tracking
  let completed = 0;
  let running = 0;
  let errors = 0;
  let timeouts = 0;
  const startedAt = Date.now();

  // Tick the progress bar every 300ms while running. Disabled in quiet
  // mode (multi-dataset parallel runs interleave too many concurrent
  // progress bars to be readable).
  const tick = (isTTY && !config.quiet)
    ? setInterval(() => renderProgress(completed, total, running, errors, Date.now() - startedAt), 300)
    : null;

  async function runRow(row: InputRow, index: number): Promise<void> {
    running++;
    if (!config.quiet) renderProgress(completed, total, running, errors, Date.now() - startedAt);

    const ctx: BenchmarkAnalystContext = {
      connections: row.allowed_connections
        .map((name) => connectionsByName.get(name))
        .filter((c): c is ConnectionInfo => !!c),
      contextDocs: [row.docs, row.additional_docs].filter(Boolean).join('\n\n') || undefined,
    };

    // Multi-run fan-out: execute the agent `timesRun` times in parallel
    // against the same input. Each run independently acquires an
    // `MAX_AGENTS_CONCURRENCY` slot, then arms its own per-run timer
    // (so queue-wait time is outside the timeout budget). The global
    // `MAX_LLM_CONCURRENCY` LLM gate inside the orchestrator further
    // bounds total in-flight provider calls.
    const rowStart = Date.now();
    const rowTimeoutMs = config.rowTimeoutMs ?? 0;

    type RunOutcome =
      | { kind: 'ok'; log: ConversationLog; error?: string }
      | { kind: 'cancelled'; reason: string };

    const outcomes = await Promise.all(
      Array.from({ length: timesRun }, async (): Promise<RunOutcome> => {
        // Park here until an agent slot is available. The per-run
        // timeout is NOT armed yet — queue-wait is free.
        await agentSemaphore.acquire();

        const orch = new Orchestrator(config.registrables);
        const agent = new config.agentClass(orch, { userMessage: row.user_message }, ctx);

        // Per-run timeout, armed AFTER slot acquisition: when it fires,
        // cancel the orchestrator (which aborts pi-ai's stream) and
        // flag this run as cancelled. The try/catch catches the abort
        // error, but we discriminate via `runCancelled` so we mark it
        // timeout vs. error.
        let runCancelled = false;
        const runTimeoutHandle = rowTimeoutMs > 0
          ? setTimeout(() => {
            runCancelled = true;
            orch.cancel();
          }, rowTimeoutMs)
          : null;

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
          if (runTimeoutHandle) clearTimeout(runTimeoutHandle);
          agentSemaphore.release();
        }

        if (runCancelled) {
          return { kind: 'cancelled', reason: `TIMEOUT after ${formatDuration(rowTimeoutMs)}` };
        }
        return { kind: 'ok', log: orch.log as ConversationLog, error };
      }),
    );

    // Row-atomic persistence: if ANY run within this row was cancelled
    // (per-run timeout), drop the whole row. Resume picks it up next
    // invocation and re-does all N runs.
    const cancelled = outcomes.find(
      (o): o is { kind: 'cancelled'; reason: string } => o.kind === 'cancelled',
    );
    const collectedLogs: ConversationLog[] = [];
    let firstError: string | undefined;
    for (const o of outcomes) {
      if (o.kind === 'ok') {
        collectedLogs.push(o.log);
        if (o.error && !firstError) firstError = o.error;
      }
    }

    const durationMs = Date.now() - rowStart;
    running--;

    if (cancelled) {
      timeouts++;
      const idx = `${c.dim}${String(index + 1).padStart(String(total).length)}/${total}${c.reset}`;
      const labelPrefix = config.quiet ? `${c.cyan}${label}${c.reset}  ` : '';
      const msg = row.user_message.slice(0, 65) + (row.user_message.length > 65 ? '…' : '');
      const dur = `${c.dim}${formatDuration(durationMs)}${c.reset}`;
      if (!config.quiet) clearLine();
      console.log(`  ${c.yellow}⏱${c.reset} ${labelPrefix}${idx}  ${msg}  ${dur}  ${c.yellow}${cancelled.reason}${c.reset}`);
      if (!config.quiet) renderProgress(completed, total, running, errors, Date.now() - startedAt);
      return;
    }

    completed++;
    if (firstError) errors++;

    // Emit `log` (singular) when timesRun === 1 to preserve the existing
    // output shape — the /benchmark viewer and any older tooling still
    // read `log`. Emit `logs` (plural, array) when timesRun > 1; the
    // post-processing eval_output.py script collapses it back to `log`.
    const result: BenchmarkResult = {
      input_index: index,
      input: row,
      ...(timesRun > 1
        ? { logs: collectedLogs }
        : { log: collectedLogs[0] }),
      duration_ms: durationMs,
      error: firstError,
      connections: entries,
    };
    appendFileSync(outputPath, JSON.stringify(result) + '\n');

    // Log completion above the progress bar
    if (!config.quiet) clearLine();
    const icon = firstError ? `${c.red}✗${c.reset}` : `${c.green}✓${c.reset}`;
    const idx = `${c.dim}${String(index + 1).padStart(String(total).length)}/${total}${c.reset}`;
    // In quiet (parallel) mode the dataset label prefixes the row line so
    // interleaved completions from different datasets are distinguishable.
    const labelPrefix = config.quiet ? `${c.cyan}${label}${c.reset}  ` : '';
    const msg = row.user_message.slice(0, 65) + (row.user_message.length > 65 ? '…' : '');
    const dur = `${c.dim}${formatDuration(durationMs)}${c.reset}`;
    const runsSuffix = timesRun > 1 ? `  ${c.dim}×${collectedLogs.length}${c.reset}` : '';
    const errMsg = firstError ? `  ${c.red}${firstError.slice(0, 60)}${c.reset}` : '';
    console.log(`  ${icon} ${labelPrefix}${idx}  ${msg}  ${dur}${runsSuffix}${errMsg}`);
    if (!config.quiet) renderProgress(completed, total, running, errors, Date.now() - startedAt);
  }

  // Dispatch every remaining row at once. Two stacked throttles:
  //   - `MAX_AGENTS_CONCURRENCY` (in this module) caps simultaneous
  //     orchestrator runs and gates the per-row timeout — queued rows
  //     don't burn their timeout budget.
  //   - `MAX_LLM_CONCURRENCY` (inside the Orchestrator) caps in-flight
  //     provider calls process-wide. Both default to "no cap".
  await Promise.all(remainingRows.map(({ row, i }) => runRow(row, i)));

  if (tick) clearInterval(tick);
  const totalMs = Date.now() - startedAt;

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
  return { rows: completed, errors, timeouts, durationMs: totalMs };
}

export { type ConnectionInfo };
