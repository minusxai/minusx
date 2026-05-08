// Generic benchmark runner. Loads connections, runs input rows through an
// agent class with a concurrency limit, writes output JSONL.
//
// Each benchmark file (e.g. dataanalystbench.ts) defines config + agent,
// then calls runBenchmark() — this module does the rest.

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { MXAgent, RegistrableClass } from '@/orchestrator/types';
import {
  setupBenchmarkSources,
  type BenchmarkConnectionEntry,
} from '@/agents/benchmark-analyst/connection-source';
import { getNodeConnector } from '@/lib/connections';
import type { NodeConnector } from '@/lib/connections/base';
import type { ConnectionInfo } from '@/agents/benchmark-analyst/types';
import { convertOrchestratorLog } from '@/lib/benchmark/log-converter';

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
}

export interface BenchmarkResult {
  input: InputRow;
  log: unknown;
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

export function logSummary(datasets: number, totalRows: number, totalErrors: number, totalMs: number): void {
  const dur = formatDuration(totalMs);
  const errStr = totalErrors > 0 ? `  ${c.red}${totalErrors} errors${c.reset}` : '';
  console.log(`\n${c.bold}${c.magenta}▸ Done${c.reset}  ${datasets} datasets, ${totalRows} rows${errStr}  ${c.dim}${dur}${c.reset}\n`);
}

// ── Runner ────────────────────────────────────────────────────────────────

export interface DatasetResult {
  rows: number;
  errors: number;
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

  // Wire sources once with all connections (per-row scoping via ctx.connections)
  setupBenchmarkSources(connectorsByName, new Set(connectorsByName.keys()));

  // Load input rows
  const inputRows: InputRow[] = readFileSync(inputPath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as InputRow);

  if (inputRows.length === 0) {
    console.error(`  ${c.red}No rows in ${inputPath}${c.reset}`);
    process.exit(1);
  }

  // Truncate output
  writeFileSync(outputPath, '');
  const concurrency = config.concurrency ?? 1;
  const total = inputRows.length;

  console.log(`\n  ${c.bold}${label}${c.reset}  ${c.dim}${total} rows, concurrency=${concurrency}${c.reset}`);
  console.log(`  ${c.dim}${outputPath}${c.reset}\n`);

  // Tracking
  let completed = 0;
  let running = 0;
  let errors = 0;
  const startedAt = Date.now();

  // Tick the progress bar every 300ms while running
  const tick = isTTY
    ? setInterval(() => renderProgress(completed, total, running, errors, Date.now() - startedAt), 300)
    : null;

  async function runRow(row: InputRow, index: number): Promise<void> {
    running++;
    renderProgress(completed, total, running, errors, Date.now() - startedAt);

    const ctx = {
      connections: row.allowed_connections
        .map((name) => connectionInfos.get(name))
        .filter((ci): ci is ConnectionInfo => !!ci),
    };
    const orch = new Orchestrator(config.registrables);
    const agent = new config.agentClass(orch, { userMessage: row.user_message }, ctx);

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
    }

    const durationMs = Date.now() - rowStart;
    running--;
    completed++;
    if (error) errors++;

    const result: BenchmarkResult = { input: row, log: convertOrchestratorLog(orch.log as any), duration_ms: durationMs, error };
    appendFileSync(outputPath, JSON.stringify(result) + '\n');

    // Log completion above the progress bar
    clearLine();
    const icon = error ? `${c.red}✗${c.reset}` : `${c.green}✓${c.reset}`;
    const idx = `${c.dim}${String(index + 1).padStart(String(total).length)}/${total}${c.reset}`;
    const msg = row.user_message.slice(0, 65) + (row.user_message.length > 65 ? '…' : '');
    const dur = `${c.dim}${formatDuration(durationMs)}${c.reset}`;
    const errMsg = error ? `  ${c.red}${error.slice(0, 60)}${c.reset}` : '';
    console.log(`  ${icon} ${idx}  ${msg}  ${dur}${errMsg}`);
    renderProgress(completed, total, running, errors, Date.now() - startedAt);
  }

  // Simple concurrency pool
  const queue = inputRows.map((row, i) => ({ row, i }));
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      await runRow(item.row, item.i);
    }
  });
  await Promise.all(workers);

  if (tick) clearInterval(tick);
  // Render final progress bar (stays visible)
  clearLine();
  const totalMs = Date.now() - startedAt;
  console.log(progressLine(completed, total, 0, errors, totalMs));

  return { rows: completed, errors, durationMs: totalMs };
}

export { type ConnectionInfo };
