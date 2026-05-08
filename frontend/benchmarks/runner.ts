// Generic benchmark runner. Loads connections, runs input rows through an
// agent class with a concurrency limit, writes output JSONL.
//
// Each benchmark file (e.g. dataanalystbench.ts) defines config + agent,
// then calls runBenchmark() — this module does the rest.

// Suppress Node's TLS warning emitted when NODE_TLS_REJECT_UNAUTHORIZED=0
// is set in .env (loaded before us via --env-file).
const _origEmitWarning = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  if (typeof warning === 'string' && warning.includes('NODE_TLS_REJECT_UNAUTHORIZED')) return;
  return (_origEmitWarning as Function).call(process, warning, ...args);
}) as typeof process.emitWarning;

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
}

export interface BenchmarkResult {
  input: InputRow;
  log: unknown;
  duration_ms: number;
  error?: string;
}

// ── Progress display ──────────────────────────────────────────────────────

const BAR_WIDTH = 25;
const isTTY = process.stderr.isTTY ?? false;

function progressBar(done: number, total: number, running: number, errors: number, elapsedMs: number): string {
  const pct = total > 0 ? done / total : 0;
  const filled = Math.round(pct * BAR_WIDTH);
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
  const elapsed = (elapsedMs / 1000).toFixed(1);
  const errStr = errors > 0 ? ` | ${errors} failed` : '';
  return `  [${bar}] ${done}/${total} done | ${running} running${errStr} | ${elapsed}s elapsed`;
}

function renderProgress(done: number, total: number, running: number, errors: number, elapsedMs: number): void {
  if (!isTTY) return;
  process.stderr.write(`\r\x1b[K${progressBar(done, total, running, errors, elapsedMs)}`);
}

function clearProgress(): void {
  if (!isTTY) process.stderr.write('\n');
  else process.stderr.write('\r\x1b[K');
}

// ── Runner ────────────────────────────────────────────────────────────────

export async function runBenchmark(config: BenchmarkRunConfig): Promise<void> {
  const inputPath = path.resolve(config.input);
  const connectionsPath = path.resolve(config.connections);
  const outputPath = path.join(
    path.dirname(inputPath),
    path.basename(inputPath).replace('input', 'output'),
  );

  // Load connections
  const connectorsByName = new Map<string, NodeConnector>();
  const connectionInfos = new Map<string, ConnectionInfo>();
  const entries = JSON.parse(readFileSync(connectionsPath, 'utf-8')) as BenchmarkConnectionEntry[];
  for (const { name, dialect, config: connConfig, description } of entries) {
    const c = getNodeConnector(name, dialect, connConfig as Record<string, unknown>);
    if (!c) throw new Error(`Unknown dialect '${dialect}' for connection '${name}'`);
    connectorsByName.set(name, c);
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
    console.error(`No rows in ${inputPath}`);
    process.exit(1);
  }

  // Truncate output
  writeFileSync(outputPath, '');
  const concurrency = config.concurrency ?? 1;
  const total = inputRows.length;
  console.log(`  ${total} rows, concurrency=${concurrency}, output → ${outputPath}\n`);

  // Tracking
  let completed = 0;
  let running = 0;
  let errors = 0;
  const startedAt = Date.now();

  // Tick the progress bar every 500ms while running
  const tick = isTTY
    ? setInterval(() => renderProgress(completed, total, running, errors, Date.now() - startedAt), 500)
    : null;

  async function runRow(row: InputRow, index: number): Promise<void> {
    running++;
    renderProgress(completed, total, running, errors, Date.now() - startedAt);

    const ctx = {
      connections: row.allowed_connections
        .map((name) => connectionInfos.get(name))
        .filter((c): c is ConnectionInfo => !!c),
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

    const result: BenchmarkResult = { input: row, log: orch.log, duration_ms: durationMs, error };
    appendFileSync(outputPath, JSON.stringify(result) + '\n');

    // Log completion above the progress bar
    clearProgress();
    const status = error ? `  ✗ [${index + 1}]` : `  ✓ [${index + 1}]`;
    const msg = row.user_message.slice(0, 70) + (row.user_message.length > 70 ? '…' : '');
    const dur = `${(durationMs / 1000).toFixed(1)}s`;
    console.log(`${status} ${msg} (${dur})${error ? ` — ${error.slice(0, 80)}` : ''}`);
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
  clearProgress();

  const totalTime = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`  Done: ${completed} rows in ${totalTime}s (${errors} failed). Output: ${outputPath}`);
}

export { type ConnectionInfo };
