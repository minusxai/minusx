import 'server-only';
import * as fs from 'fs';
import Database from 'better-sqlite3';
import {
  NodeConnector,
  type SchemaEntry,
  type SchemaTable,
  type SchemaColumn,
  type TableIndex,
  type QueryResult,
  type TestConnectionResult,
} from '@/lib/connections/base';
import { resolveDuckDbFilePath } from '@/lib/connections/duckdb-connector';
import { inlineSqlParams } from '@/lib/sql/inline-params';

/**
 * Benchmark sqlite connector. Runs queries directly against the SQLite
 * file via `better-sqlite3` — no DuckDB anywhere in the path. The agent
 * sees real SQLite semantics: native types from `PRAGMA table_info`,
 * native error messages, native function availability.
 *
 * Read-only. Lazy connection: the db handle is opened on first use and
 * kept open for the lifetime of the connector. Caller should `close()`
 * when done (the benchmark currently lets the process exit do that).
 */
export class BenchmarkSqliteConnector extends NodeConnector {
  private readonly absPath: string;
  private db: Database.Database | null = null;

  constructor(name: string, config: Record<string, unknown>) {
    super(name, config);
    this.absPath = resolveDuckDbFilePath(config.file_path as string);
  }

  private open(): Database.Database {
    if (!this.db) {
      this.db = new Database(this.absPath, { readonly: true, fileMustExist: true });
    }
    return this.db;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async testConnection(includeSchema = false): Promise<TestConnectionResult> {
    if (!fs.existsSync(this.absPath)) {
      return { success: false, message: `File not found: ${this.absPath}` };
    }
    try {
      this.open().prepare('SELECT 1').get();
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
    // _timeoutMs is intentionally unused: better-sqlite3 is synchronous,
    // so honouring a timeout requires cross-thread `db.interrupt()` —
    // tracked separately. Benchmark queries on the local fixtures
    // finish well within typical row-level budgets without it.
    const stmt = this.open().prepare(sql);
    const rows = (params ? stmt.all(params as Record<string, unknown>) : stmt.all()) as Record<string, unknown>[];
    const cols = stmt.columns();
    return {
      columns: cols.map((c) => c.name),
      types: cols.map((c) => (c.type ?? '').toUpperCase()),
      rows: makeJsonSafe(rows),
      finalQuery: inlineSqlParams(sql, params),
    };
  }

  async getSchema(): Promise<SchemaEntry[]> {
    const db = this.open();
    const tableNames = (db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all() as Array<{ name: string }>).map((r) => r.name);

    const tables: SchemaTable[] = tableNames.map((table) => ({
      table,
      columns: readColumns(db, table),
      indexes: readIndexes(db, table),
    }));
    return [{ schema: 'main', tables }];
  }
}

function readColumns(db: Database.Database, table: string): SchemaColumn[] {
  const rows = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{
    name: string;
    type: string;
  }>;
  return rows.map((c) => ({
    name: c.name,
    // SQLite's type-affinity allows the empty string (no declared type) —
    // surface NUMERIC, which is what SQLite's own affinity rules would
    // assign. Anything declared (even `MY_CUSTOM_TYPE`) is preserved.
    type: (c.type || 'NUMERIC').toUpperCase(),
  }));
}

function readIndexes(db: Database.Database, table: string): TableIndex[] {
  const idxList = db.prepare(`PRAGMA index_list(${quoteIdent(table)})`).all() as Array<{
    name: string;
    unique: number;
  }>;
  // Sort by name for deterministic order — PRAGMA returns by `seq`, which
  // varies with creation order and is unhelpful when the schema is
  // surfaced to an LLM.
  const sorted = [...idxList].sort((a, b) => a.name.localeCompare(b.name));
  return sorted.map((ix) => {
    const cols = db.prepare(`PRAGMA index_info(${quoteIdent(ix.name)})`).all() as Array<{
      name: string | null;
    }>;
    return {
      name: ix.name,
      // Expression indexes have null column names; filter them out — the
      // agent can't filter on an unnamed expression anyway.
      columns: cols.map((c) => c.name).filter((n): n is string => typeof n === 'string'),
      unique: ix.unique === 1,
    };
  });
}

function quoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

function makeJsonSafe(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return JSON.parse(JSON.stringify(rows, (_, v) => {
    if (typeof v === 'bigint') {
      return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER)
        ? Number(v)
        : v.toString();
    }
    if (v instanceof Uint8Array) {
      return Buffer.from(v).toString('base64');
    }
    return v;
  }));
}
