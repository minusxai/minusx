import 'server-only';
import * as fs from 'fs';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  NodeConnector,
  type SchemaEntry,
  type QueryResult,
  type TestConnectionResult,
} from '@/lib/connections/base';
import { resolveDuckDbFilePath } from '@/lib/connections/duckdb-connector';
import { inlineSqlParams } from '@/lib/sql/inline-params';

/**
 * Benchmark sqlite connector. Runs queries against the SQLite file via
 * `better-sqlite3`, but routes each call through a pool of worker_threads
 * so the main JS thread is never blocked on `stmt.all()`. Multiple
 * sub-agents querying in parallel hit different workers — their
 * synchronous native calls run on independent OS threads instead of
 * serializing on the main event loop.
 *
 * Pool size: defaults to 4, override via `SQLITE_WORKER_POOL_SIZE`.
 * One handle per worker — read-only SQLite tolerates multiple readers
 * on the same file without contention.
 */
const DEFAULT_POOL_SIZE = 4;

function workerPoolSize(): number {
  // eslint-disable-next-line no-restricted-syntax -- benchmark CLI knob, not a request-scoped module
  const raw = process.env.SQLITE_WORKER_POOL_SIZE;
  if (!raw) return DEFAULT_POOL_SIZE;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_POOL_SIZE;
}

interface PendingCall<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
}

interface QueryPayload {
  columns: string[];
  types: string[];
  rows: Record<string, unknown>[];
}

export class BenchmarkSqliteConnector extends NodeConnector {
  private readonly absPath: string;
  private workers: Worker[] | null = null;
  private nextRequestId = 1;
  private nextWorkerIdx = 0;
  private readonly pending = new Map<number, PendingCall<unknown>>();
  private initPromise: Promise<void> | null = null;
  private closed = false;

  constructor(name: string, config: Record<string, unknown>) {
    super(name, config);
    this.absPath = resolveDuckDbFilePath(config.file_path as string);
  }

  // ── pool lifecycle ──────────────────────────────────────────────────────

  private async ensureOpen(): Promise<void> {
    if (this.closed) throw new Error(`Connector '${this.name}' is closed`);
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.spawnPool();
    return this.initPromise;
  }

  private async spawnPool(): Promise<void> {
    if (!fs.existsSync(this.absPath)) {
      throw new Error(`File not found: ${this.absPath}`);
    }
    const workerPath = join(dirname(fileURLToPath(import.meta.url)), 'sqlite-worker.cjs');
    const n = workerPoolSize();
    const readyPromises: Promise<void>[] = [];
    const workers: Worker[] = [];

    for (let i = 0; i < n; i++) {
      const worker = new Worker(workerPath, { workerData: { dbPath: this.absPath } });
      workers.push(worker);

      const ready = new Promise<void>((resolve, reject) => {
        const onMessage = (msg: { type?: string; error?: string }): void => {
          if (msg?.type === 'ready') {
            worker.off('message', onMessage);
            resolve();
          } else if (msg?.type === 'fatal') {
            worker.off('message', onMessage);
            reject(new Error(msg.error ?? 'worker fatal error'));
          }
        };
        worker.on('message', onMessage);
        worker.once('error', (err) => reject(err));
        worker.once('exit', (code) => {
          if (code !== 0) reject(new Error(`worker exited with code ${code} before ready`));
        });
      });
      readyPromises.push(ready);
    }

    try {
      await Promise.all(readyPromises);
    } catch (err) {
      // Tear down any workers that did come up if init failed.
      for (const w of workers) w.terminate().catch(() => { /* ignore */ });
      this.initPromise = null;
      throw err;
    }

    // Now wire the main message handler for each worker — responses get
    // routed to the correct pending Promise by request id.
    for (const worker of workers) {
      worker.on('message', (msg: { id?: number; ok?: boolean; value?: unknown; error?: string }) => {
        if (msg == null || typeof msg.id !== 'number') return;
        const pending = this.pending.get(msg.id);
        if (!pending) return;
        this.pending.delete(msg.id);
        if (msg.ok) pending.resolve(msg.value);
        else pending.reject(new Error(msg.error ?? 'sqlite worker error'));
      });
      worker.on('error', (err) => this.rejectAll(err));
    }
    this.workers = workers;
  }

  private rejectAll(err: Error): void {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }

  /** Send a typed request to the next worker in round-robin order. */
  private async dispatch<T>(message: { type: string; sql?: string; params?: Record<string, unknown> }): Promise<T> {
    await this.ensureOpen();
    const workers = this.workers!;
    const worker = workers[this.nextWorkerIdx];
    this.nextWorkerIdx = (this.nextWorkerIdx + 1) % workers.length;

    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ id, ...message });
    });
  }

  // ── public API (unchanged contract) ─────────────────────────────────────

  close(): void {
    if (!this.workers) {
      this.closed = true;
      return;
    }
    for (const w of this.workers) {
      try { w.postMessage({ type: 'close' }); } catch { /* ignore */ }
    }
    this.workers = null;
    this.initPromise = null;
    this.closed = true;
  }

  async testConnection(includeSchema = false): Promise<TestConnectionResult> {
    if (!fs.existsSync(this.absPath)) {
      return { success: false, message: `File not found: ${this.absPath}` };
    }
    try {
      await this.dispatch<true>({ type: 'ping' });
      if (includeSchema) {
        const schemas = await this.getSchema();
        return { success: true, message: 'Connection successful', schema: { schemas } };
      }
      return { success: true, message: 'Connection successful' };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async query(
    sql: string,
    params?: Record<string, string | number>,
    _timeoutMs?: number,
  ): Promise<QueryResult> {
    // _timeoutMs is intentionally unused. better-sqlite3 is synchronous
    // inside the worker; cancellation would need a cross-thread
    // `db.interrupt()` plumb-through. Tracked separately.
    const payload = await this.dispatch<QueryPayload>({
      type: 'query',
      sql,
      params: params as Record<string, unknown> | undefined,
    });
    return {
      columns: payload.columns,
      types: payload.types,
      rows: payload.rows,
      finalQuery: inlineSqlParams(sql, params),
    };
  }

  async getSchema(): Promise<SchemaEntry[]> {
    return this.dispatch<SchemaEntry[]>({ type: 'getSchema' });
  }
}
