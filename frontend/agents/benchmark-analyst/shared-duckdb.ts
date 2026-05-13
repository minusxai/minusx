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

  private constructor(private readonly instance: DuckDBInstance) {}

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

    const conn = await this.instance.connect();
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
      conn.closeSync();
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
    const conn = await this.instance.connect();
    try {
      // USE is per-connection. Sets default catalog so the agent's
      // unqualified `FROM tablename` resolves to `<name>.main.tablename`.
      await conn.run(`USE ${quoteIdent(name)}`);
      return await fn(conn);
    } finally {
      conn.closeSync();
    }
  }

  async query(name: string, sql: string): Promise<QueryResult> {
    return this.withConnection(name, async (conn) => {
      const result = await conn.run(sql);
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
      return Array.from(byTable.entries()).map(([schema, tables]) => ({
        schema,
        tables: Array.from(tables.entries()).map(([table, columns]) => ({ table, columns })),
      }));
    });
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
 * NodeConnector implementation that routes to the shared DuckDBInstance
 * keyed by `name`. Looks identical to `DuckDbConnector` /
 * `SqliteConnector` from the caller's perspective.
 */
class BenchmarkSharedDuckdbConnector extends NodeConnector {
  constructor(name: string, private readonly shared: BenchmarkSharedDuckdb) {
    super(name, {});
  }

  async testConnection(includeSchema = false): Promise<TestConnectionResult> {
    try {
      await this.shared.query(this.name, 'SELECT 1');
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

  async query(sql: string): Promise<QueryResult> {
    return this.shared.query(this.name, sql);
  }

  async getSchema(): Promise<SchemaEntry[]> {
    return this.shared.getSchema(this.name);
  }
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
export async function getOrCreateBenchmarkConnector(
  name: string,
  dialect: string,
  config: Record<string, unknown>,
): Promise<NodeConnector> {
  if (isAttachable(dialect)) {
    const filePath = (config as { file_path?: unknown }).file_path;
    if (typeof filePath !== 'string') {
      throw new Error(`Missing or non-string file_path for connection '${name}'`);
    }
    const absPath = resolveDuckDbFilePath(filePath);
    const shared = await getOrCreateShared();
    await shared.ensureAttached([{ name, dialect, absPath }]);
    return new BenchmarkSharedDuckdbConnector(name, shared);
  }
  const conn = getNodeConnector(name, dialect, config);
  if (!conn) throw new Error(`Unknown dialect '${dialect}' for connection '${name}'`);
  return conn;
}
