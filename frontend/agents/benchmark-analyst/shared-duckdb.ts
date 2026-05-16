// Benchmark-only: one process-wide in-memory DuckDBInstance shared by
// every sqlite/duckdb connection across every dataset. ATTACHes
// cumulatively as `getOrCreateBenchmarkConnector` is called per
// connection (typically from `BaseExecuteQuery._initialiseConnectors`),
// so parallel datasets reuse the same instance (one thread pool, one
// buffer cache) instead of each spawning their own.
//
// Scope: **benchmark only**. Production connectors still use one
// DuckDBInstance per file (see `lib/connections/duckdb-registry.ts`
// and `sqlite-via-duckdb-registry.ts`). The per-file isolation in
// production is the multi-tenant boundary — a user's instance
// physically can't see databases they don't have access to — and we
// don't want to weaken it.
//
// Security: deliberately none. No `allowed_paths`, no
// `enable_external_access = false`. The benchmark process is trusted
// (we're running our own agent against our own dataset files in a
// short-lived CLI), so the per-file production sandbox isn't carrying
// weight here.

import 'server-only';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { resolveDuckDbFilePath } from '@/lib/connections/duckdb-connector';
import { getNodeConnector } from '@/lib/connections';
import { collectDuckDbIndexes } from '@/lib/connections/duckdb-indexes';
import { runDuckDbWithTimeout } from '@/lib/connections/duckdb-query';
import { NodeConnector, type SchemaEntry, type QueryResult, type TestConnectionResult } from '@/lib/connections/base';

// Make rows JSON-safe (BigInt → Number where it fits; else string).
// Same shape as the production connectors so the runner output JSONL
// stays identical across the per-file / shared-instance paths.
function makeJsonSafe(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return JSON.parse(JSON.stringify(rows, (_, v) => {
    if (typeof v === 'bigint') {
      return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER)
        ? Number(v) : v.toString();
    }
    return v;
  }));
}

type AttachableDialect = 'sqlite' | 'duckdb';
function isAttachable(dialect: string): dialect is AttachableDialect {
  return dialect === 'sqlite' || dialect === 'duckdb';
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// ── V2 handle-table helpers ────────────────────────────────────────────────
// Map an arbitrary source type string to a DuckDB column type for handle
// tables. Best-effort: anything unrecognised becomes VARCHAR.
function mapTypeToDuckDb(type: string | undefined): string {
  const upper = (type ?? 'VARCHAR').toUpperCase();
  if (upper.includes('INT')) return 'BIGINT';
  if (
    upper.includes('DOUBLE') || upper.includes('FLOAT') ||
    upper.includes('DECIMAL') || upper.includes('NUMERIC') || upper.includes('REAL')
  ) return 'DOUBLE';
  if (upper.includes('BOOL')) return 'BOOLEAN';
  if (upper === 'DATE') return 'DATE';
  if (upper.includes('TIMESTAMP') || upper.includes('DATETIME')) return 'TIMESTAMP';
  return 'VARCHAR';
}

// Escape a JS value for inline use in a DuckDB INSERT ... VALUES.
function escapeSqlValue(v: unknown): string {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
}

interface AttachedEntry {
  name: string;
  dialect: AttachableDialect;
  absPath: string;
}

/**
 * Owns the shared in-memory DuckDBInstance + the set of ATTACHed
 * databases. Singleton-managed via `getOrCreateShared` below.
 */
class BenchmarkSharedDuckdb {
  private readonly attached = new Map<string, AttachedEntry>();
  private installedSqlite = false;
  // Serialise ATTACH calls. Multiple parallel datasets may call
  // `ensureAttached` concurrently; ATTACH modifies instance-wide state
  // and we must not interleave the ATTACH / map-update sequence across
  // calls (or two callers could both decide a name is new and try to
  // ATTACH the same alias twice).
  private chain: Promise<void> = Promise.resolve();

  // Bounded pool of long-lived connections, reused across every query /
  // schema / attach. The previous connect()/closeSync()-per-query pattern
  // churned native connections hard: `DAB_DOUBLE_CHECK` × `DAB_TIMES_RUN`
  // can put ~30 agents on this single shared instance, and concurrent
  // connect/close on it triggered a native double-free in the DuckDB
  // addon (`malloc: pointer being freed was not allocated`). Pooled
  // connections are created once, reused, and never closed mid-run — the
  // benchmark CLI hard-exits at the end, so the OS reclaims them. `USE`
  // is per-query, so any pooled connection can serve any attached db.
  private static readonly MAX_POOL = 8;
  private readonly idle: DuckDBConnection[] = [];
  private readonly waiters: Array<(conn: DuckDBConnection) => void> = [];
  private poolSize = 0;

  private constructor(private readonly instance: DuckDBInstance) {}

  /**
   * Take a connection from the pool, creating one if under `MAX_POOL`,
   * otherwise waiting for a release. Every `acquireConnection` MUST be
   * paired with exactly one `releaseConnection` (use try/finally).
   */
  private async acquireConnection(): Promise<DuckDBConnection> {
    const free = this.idle.pop();
    if (free) return free;
    if (this.poolSize < BenchmarkSharedDuckdb.MAX_POOL) {
      // Synchronous check + increment — no await between them, so two
      // concurrent callers can't both pass the cap check.
      this.poolSize++;
      try {
        return await this.instance.connect();
      } catch (err) {
        this.poolSize--;
        throw err;
      }
    }
    return new Promise<DuckDBConnection>((resolve) => this.waiters.push(resolve));
  }

  /** Return a connection to the pool — hands it to the next waiter if any. */
  private releaseConnection(conn: DuckDBConnection): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(conn);
    else this.idle.push(conn);
  }

  static async create(): Promise<BenchmarkSharedDuckdb> {
    const instance = await DuckDBInstance.create(':memory:');
    return new BenchmarkSharedDuckdb(instance);
  }

  /**
   * Idempotently ATTACH the given entries. Skips names already attached
   * to the same path; throws if a name collides with a different path
   * (a sign that two datasets are using the same alias for different
   * files — we can't safely route queries in that case).
   */
  ensureAttached(entries: AttachedEntry[]): Promise<void> {
    const work = this.chain.then(() => this._doAttach(entries));
    // Don't propagate failures into subsequent chain links: each caller
    // observes its own failure via the returned Promise, but later
    // calls should still be able to make progress.
    this.chain = work.catch(() => undefined);
    return work;
  }

  private async _doAttach(entries: AttachedEntry[]): Promise<void> {
    const toAttach: AttachedEntry[] = [];
    for (const e of entries) {
      const existing = this.attached.get(e.name);
      if (existing) {
        if (existing.absPath !== e.absPath) {
          throw new Error(
            `Benchmark shared DuckDB alias '${e.name}' is already attached to '${existing.absPath}'; cannot re-attach to '${e.absPath}'. Rename one of the connections.`,
          );
        }
        continue;
      }
      toAttach.push(e);
    }
    if (toAttach.length === 0) return;

    const conn = await this.acquireConnection();
    try {
      if (!this.installedSqlite && toAttach.some((e) => e.dialect === 'sqlite')) {
        await conn.run('INSTALL sqlite');
        await conn.run('LOAD sqlite');
        this.installedSqlite = true;
      }

      for (const e of toAttach) {
        const typeClause = e.dialect === 'sqlite' ? ', TYPE SQLITE' : '';
        await conn.run(
          `ATTACH ${quoteLiteral(e.absPath)} AS ${quoteIdent(e.name)} (READ_ONLY${typeClause})`,
        );
        this.attached.set(e.name, e);
      }
    } finally {
      this.releaseConnection(conn);
    }
  }

  has(name: string): boolean {
    return this.attached.has(name);
  }

  private async withConnection<T>(
    name: string,
    fn: (conn: DuckDBConnection) => Promise<T>,
  ): Promise<T> {
    if (!this.attached.has(name)) {
      throw new Error(`'${name}' is not attached to the shared DuckDB instance`);
    }
    const conn = await this.acquireConnection();
    try {
      // USE is per-connection — and re-run on every borrow, since a
      // pooled connection may last have served a different catalog. Sets
      // the default catalog so the agent's unqualified `FROM tablename`
      // resolves to `<name>.main.tablename`.
      await conn.run(`USE ${quoteIdent(name)}`);
      return await fn(conn);
    } finally {
      this.releaseConnection(conn);
    }
  }

  async query(name: string, sql: string, timeoutMs?: number): Promise<QueryResult> {
    return this.withConnection(name, async (conn) => {
      // Best-effort statement timeout via `conn.interrupt()` — see
      // `runDuckDbWithTimeout`. Shared with the native DuckDb/Sqlite
      // connectors so the interrupt logic lives in exactly one place.
      const result = await runDuckDbWithTimeout(conn, sql, timeoutMs);
      const cc = result.columnCount;
      const columns: string[] = [];
      const types: string[] = [];
      for (let i = 0; i < cc; i++) {
        columns.push(result.columnName(i));
        types.push(result.columnType(i).toString());
      }
      const rawRows = await result.getRowObjectsJS() as Record<string, unknown>[];
      const rows = makeJsonSafe(rawRows);
      return { columns, types, rows, finalQuery: sql };
    });
  }

  async getSchema(name: string): Promise<SchemaEntry[]> {
    return this.withConnection(name, async (conn) => {
      const result = await conn.run(
        `SELECT table_schema, table_name, column_name, data_type
         FROM information_schema.columns
         WHERE table_catalog = ${quoteLiteral(name)}
         ORDER BY table_schema, table_name, ordinal_position`,
      );
      const rows = await result.getRowObjectsJS() as Array<{
        table_schema: string;
        table_name: string;
        column_name: string;
        data_type: string;
      }>;
      const byTable = new Map<string, Map<string, Array<{ name: string; type: string }>>>();
      for (const r of rows) {
        if (!byTable.has(r.table_schema)) byTable.set(r.table_schema, new Map());
        const tableMap = byTable.get(r.table_schema)!;
        if (!tableMap.has(r.table_name)) tableMap.set(r.table_name, []);
        tableMap.get(r.table_name)!.push({ name: r.column_name, type: r.data_type });
      }

      // Indexes on the attached database (sqlite indexes surface through
      // DuckDB's `duckdb_indexes()` — filtered to this catalog by `name`).
      const indexMap = await collectDuckDbIndexes(conn, name);

      return Array.from(byTable.entries()).map(([schema, tables]) => ({
        schema,
        tables: Array.from(tables.entries()).map(([table, columns]) => ({
          table,
          columns,
          indexes: indexMap.get(`${schema}.${table}`) ?? [],
        })),
      }));
    });
  }

  // ── V2 handle tables ─────────────────────────────────────────────────────
  // V2's handle store registers query results as tables in this instance's
  // in-memory `memory` catalog. Co-locating them with the ATTACHed dataset
  // catalogs is what lets `ExecuteQuery` join `FROM handle_xyz` against live
  // connection data — they're all one DuckDBInstance. Fully-qualified
  // `memory.main.<id>` names so they resolve regardless of the connection's
  // current `USE` catalog.

  /** Register (or replace) a query result as a queryable `memory.main` table. */
  async registerHandleTable(handleId: string, result: QueryResult): Promise<void> {
    const conn = await this.acquireConnection();
    try {
      const tbl = `memory.main.${quoteIdent(handleId)}`;
      if (result.columns.length === 0) {
        await conn.run(`CREATE OR REPLACE TABLE ${tbl} (placeholder VARCHAR)`);
        return;
      }
      // No defensive dedup here: if the source query produced duplicate
      // column names, let DuckDB's native error propagate. The caller
      // (`storeHandle`) catches it and surfaces a `handle_error` to the
      // agent, who then sees an actionable message rather than a silently
      // renamed column appearing in their handle.
      const colDefs = result.columns
        .map((col, i) => `${quoteIdent(col)} ${mapTypeToDuckDb(result.types?.[i])}`)
        .join(', ');
      await conn.run(`CREATE OR REPLACE TABLE ${tbl} (${colDefs})`);
      if (result.rows.length > 0) {
        const colNames = result.columns.map(quoteIdent).join(', ');
        const valueRows = result.rows
          .map((row) => `(${result.columns.map((c) => escapeSqlValue(row[c])).join(', ')})`)
          .join(', ');
        await conn.run(`INSERT INTO ${tbl} (${colNames}) VALUES ${valueRows}`);
      }
    } finally {
      this.releaseConnection(conn);
    }
  }

  /** Run SQL against the `memory` catalog (handle tables). */
  async queryMemory(sql: string): Promise<QueryResult> {
    const conn = await this.acquireConnection();
    try {
      await conn.run('USE memory');
      const result = await conn.run(sql);
      const cc = result.columnCount;
      const columns: string[] = [];
      const types: string[] = [];
      for (let i = 0; i < cc; i++) {
        columns.push(result.columnName(i));
        types.push(result.columnType(i).toString());
      }
      const rows = makeJsonSafe(await result.getRowObjectsJS() as Record<string, unknown>[]);
      return { columns, types, rows, finalQuery: sql };
    } finally {
      this.releaseConnection(conn);
    }
  }

  /** Drop every handle table from the `memory` catalog. */
  async dropHandleTables(): Promise<void> {
    const conn = await this.acquireConnection();
    try {
      const result = await conn.run(
        "SELECT table_name FROM information_schema.tables WHERE table_catalog = 'memory' AND table_schema = 'main'",
      );
      const rows = await result.getRowObjectsJS() as Array<{ table_name: string }>;
      for (const row of rows) {
        await conn.run(`DROP TABLE IF EXISTS memory.main.${quoteIdent(row.table_name)}`);
      }
    } finally {
      this.releaseConnection(conn);
    }
  }
}

// Process-wide singleton. Lazily initialised on first call. The init
// race is guarded by `initPromise` — same pattern as
// `duckdb-registry.ts:12`. Concurrent first-callers all await the same
// in-flight create.
// eslint-disable-next-line no-restricted-syntax -- server-only; benchmark process singleton
let sharedInstance: BenchmarkSharedDuckdb | null = null;
// eslint-disable-next-line no-restricted-syntax -- server-only; benchmark process singleton
let initPromise: Promise<BenchmarkSharedDuckdb> | null = null;

async function getOrCreateShared(): Promise<BenchmarkSharedDuckdb> {
  if (sharedInstance) return sharedInstance;
  if (initPromise) return initPromise;
  initPromise = BenchmarkSharedDuckdb.create().then((inst) => {
    sharedInstance = inst;
    initPromise = null;
    return inst;
  }).catch((err) => {
    initPromise = null;
    throw err;
  });
  return initPromise;
}

/**
 * NodeConnector implementation that routes to the shared DuckDBInstance.
 * The agent-facing `name` (e.g. `metadata_database`) is stored on the
 * base class via `super(name, {})`; the ATTACH alias actually used inside
 * the shared instance is `internalName` (e.g. `__ds_agnews__metadata_database`).
 * That namespacing keeps two benchmark datasets running in parallel from
 * colliding on the same logical connection name pointing at different
 * physical files.
 */
class BenchmarkSharedDuckdbConnector extends NodeConnector {
  constructor(
    name: string,
    private readonly internalName: string,
    private readonly shared: BenchmarkSharedDuckdb,
  ) {
    super(name, {});
  }

  async testConnection(includeSchema = false): Promise<TestConnectionResult> {
    try {
      await this.shared.query(this.internalName, 'SELECT 1');
      if (includeSchema) {
        const schemas = await this.getSchema();
        return { success: true, message: 'Connection successful', schema: { schemas } };
      }
      return { success: true, message: 'Connection successful' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: msg };
    }
  }

  async query(
    sql: string,
    _params?: Record<string, string | number>,
    timeoutMs?: number,
  ): Promise<QueryResult> {
    return this.shared.query(this.internalName, sql, timeoutMs);
  }

  async getSchema(): Promise<SchemaEntry[]> {
    return this.shared.getSchema(this.internalName);
  }
}

/**
 * Compose the dataset-scoped ATTACH alias from the agent-facing connection
 * name plus an optional dataset key. With no key, the alias is the bare
 * name (preserving the original behaviour for non-parallel callers).
 */
function internalAttachName(name: string, datasetKey?: string): string {
  return datasetKey ? `__ds_${datasetKey}__${name}` : name;
}

/**
 * Build a single benchmark NodeConnector for one connection. Idempotent
 * with respect to the shared DuckDBInstance: sqlite/duckdb entries route
 * through a process-wide singleton (`getOrCreateShared`) with idempotent
 * `ensureAttached`, so repeated calls for the same name are cheap and
 * safe. Other dialects (postgres, bigquery, …) fall through to
 * `getNodeConnector`.
 *
 * Used by `BaseExecuteQuery._initialiseConnectors` / `BaseSearchDBSchema._initialiseConnectors`
 * to lazily wire up connectors from `ctx.connections[*]` on each tool
 * invocation. The single in-memory `:memory:` DuckDBInstance with all
 * dataset files ATTACHed is preserved across tool calls (one thread
 * pool, one buffer cache).
 */
export interface BenchmarkConnectorOptions {
  /**
   * Dataset-scoped namespace for the ATTACH alias inside the shared
   * DuckDB instance. The agent-facing connection name stays unchanged;
   * only the internal alias is prefixed. Pass `undefined` (single-dataset
   * runs / legacy callers) to keep the bare name.
   */
  datasetKey?: string;
}

export async function getOrCreateBenchmarkConnector(
  name: string,
  dialect: string,
  config: Record<string, unknown>,
  opts?: BenchmarkConnectorOptions,
): Promise<NodeConnector> {
  if (isAttachable(dialect)) {
    const filePath = (config as { file_path?: unknown }).file_path;
    if (typeof filePath !== 'string') {
      throw new Error(`Missing or non-string file_path for connection '${name}'`);
    }
    const absPath = resolveDuckDbFilePath(filePath);
    const shared = await getOrCreateShared();
    const internalName = internalAttachName(name, opts?.datasetKey);
    await shared.ensureAttached([{ name: internalName, dialect, absPath }]);
    return new BenchmarkSharedDuckdbConnector(name, internalName, shared);
  }
  const conn = getNodeConnector(name, dialect, config);
  if (!conn) throw new Error(`Unknown dialect '${dialect}' for connection '${name}'`);
  return conn;
}

// ── V2 handle-table API ────────────────────────────────────────────────────
// Thin module-level wrappers over the shared instance, used by
// `v2/handle-store.ts`. Co-locating handle tables in the shared instance is
// what makes `ExecuteQuery`'s `FROM handle_xyz` joins against live data work.

/** Register a query result as a queryable `memory.main` handle table. */
export async function registerHandleTable(handleId: string, result: QueryResult): Promise<void> {
  return (await getOrCreateShared()).registerHandleTable(handleId, result);
}

/** Run SQL directly against the registered handle tables. */
export async function queryHandleTables(sql: string): Promise<QueryResult> {
  return (await getOrCreateShared()).queryMemory(sql);
}

/** Drop every registered handle table (used by `clearHandles`). */
export async function dropHandleTables(): Promise<void> {
  return (await getOrCreateShared()).dropHandleTables();
}
