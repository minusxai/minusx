import 'server-only';
import * as fs from 'fs';
import Database from 'better-sqlite3';
import { NodeConnector, SchemaEntry, QueryResult, TestConnectionResult } from './base';
import { resolveDuckDbFilePath } from './duckdb-connector';

/**
 * Node.js SQLite connector.
 * Uses better-sqlite3 (synchronous) in read-only mode.
 * Config: { file_path: string }
 */
export class SqliteConnector extends NodeConnector {
  private readonly absPath: string;

  constructor(name: string, config: Record<string, any>) {
    super(name, config);
    this.absPath = resolveDuckDbFilePath(config.file_path);
  }

  async testConnection(includeSchema = false): Promise<TestConnectionResult> {
    if (!fs.existsSync(this.absPath)) {
      return { success: false, message: `File not found: ${this.absPath}` };
    }
    try {
      const db = new Database(this.absPath, { readonly: true });
      try {
        db.prepare('SELECT 1').get();
      } finally {
        db.close();
      }
      if (includeSchema) {
        const schemas = await this.getSchema();
        return { success: true, message: 'Connection successful', schema: { schemas } };
      }
      return { success: true, message: 'Connection successful' };
    } catch (err: any) {
      return { success: false, message: err?.message || String(err) };
    }
  }

  async query(sql: string, params?: Record<string, string | number>): Promise<QueryResult> {
    const db = new Database(this.absPath, { readonly: true });
    try {
      // Replace named params (:name) with positional ? (SQLite syntax)
      const paramValues: unknown[] = [];
      const positionalSql = sql.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
        paramValues.push(params?.[key] ?? null);
        return '?';
      });

      const stmt = db.prepare(positionalSql);
      const columnDefs = stmt.columns();
      const rows = stmt.all(...paramValues) as Record<string, unknown>[];

      const columns = columnDefs.map((c) => c.name);
      const types = columnDefs.map((c) => c.type || 'TEXT');

      return { columns, types, rows };
    } finally {
      db.close();
    }
  }

  async getSchema(): Promise<SchemaEntry[]> {
    const db = new Database(this.absPath, { readonly: true });
    try {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      ).all() as Array<{ name: string }>;

      const schemaTables = tables.map(({ name: tableName }) => {
        const cols = db.prepare(
          `PRAGMA table_info("${tableName.replace(/"/g, '""')}")`,
        ).all() as Array<{ name: string; type: string }>;
        return {
          table: tableName,
          columns: cols.map((c) => ({ name: c.name, type: c.type || 'TEXT' })),
        };
      });

      return [{ schema: 'main', tables: schemaTables }];
    } finally {
      db.close();
    }
  }
}
