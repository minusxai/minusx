import 'server-only';
import { MongoClient } from 'mongodb';
import { QueryLeaf } from '@queryleaf/lib';
import { NodeConnector, SchemaEntry, QueryResult, TestConnectionResult } from './base';

/**
 * Node.js MongoDB connector.
 *
 * Translates SQL → MongoDB queries via @queryleaf/lib so the agent's
 * `ExecuteSQL` tool can target Mongo just like it does Postgres / DuckDB
 * / SQLite. Schema inference samples one document per collection (Mongo
 * is schemaless) and uses field types from that sample.
 *
 * Config: { host: string; port: number; database: string;
 *           username?: string; password?: string }
 */

export interface MongoConfig {
  host: string;
  port: number;
  database: string;
  username?: string;
  password?: string;
}

/** Build a MongoDB connection URI from a MongoConfig. Pure — exported for tests. */
export function buildMongoUri(c: MongoConfig): string {
  const auth =
    c.username !== undefined
      ? `${encodeURIComponent(c.username)}:${encodeURIComponent(c.password ?? '')}@`
      : '';
  return `mongodb://${auth}${c.host}:${c.port}`;
}

/**
 * Map a JS / BSON value to a SQL-style type label. Used for schema columns
 * and per-result-row column types so the chat UI can render Mongo data
 * with the same display path as relational connectors.
 */
export function inferSqlType(v: unknown): string {
  if (v == null) return 'UNKNOWN';
  if (typeof v === 'string') return 'TEXT';
  if (typeof v === 'number') return Number.isInteger(v) ? 'INTEGER' : 'REAL';
  if (typeof v === 'boolean') return 'BOOLEAN';
  if (v instanceof Date) return 'TIMESTAMP';
  if (Array.isArray(v)) return 'ARRAY';
  if (typeof v === 'object') return 'OBJECT';
  return 'TEXT';
}

/**
 * Project a list of BSON documents (QueryLeaf's execute() result) onto a
 * SQL-style {columns, types} pair. Columns are the union of keys across
 * all rows; type per column is inferred from the first non-null value.
 */
export function documentsToQueryResultColumns(
  docs: ReadonlyArray<Record<string, unknown>>,
): { columns: string[]; types: string[] } {
  if (docs.length === 0) return { columns: [], types: [] };
  const seen = new Set<string>();
  for (const d of docs) for (const k of Object.keys(d)) seen.add(k);
  const columns = Array.from(seen);
  const types = columns.map((col) => {
    for (const d of docs) {
      const v = d[col];
      if (v != null) return inferSqlType(v);
    }
    return 'UNKNOWN';
  });
  return { columns, types };
}

export class MongoConnector extends NodeConnector {
  private readonly uri: string;
  private readonly database: string;
  // Lazy-init: the mongodb driver pools connections per URI internally and
  // is designed for ONE long-lived client per app, not one-per-query.
  // Opening and closing a client per call races the driver's session
  // lifecycle (MongoExpiredSessionError under any concurrency). We open
  // once on first use and let GC reclaim the connection pool when the
  // connector goes out of scope. For benchmark CLI runs the process exits
  // anyway; for v=2 chat each request builds fresh connectors that die
  // after the turn — small connection-pool leak is acceptable.
  private clientPromise: Promise<MongoClient> | null = null;

  constructor(name: string, config: Record<string, any>) {
    super(name, config);
    const c = config as MongoConfig;
    this.uri = buildMongoUri(c);
    this.database = c.database;
  }

  private getClient(): Promise<MongoClient> {
    if (!this.clientPromise) {
      const client = new MongoClient(this.uri);
      this.clientPromise = client.connect();
    }
    return this.clientPromise;
  }

  async testConnection(includeSchema = false): Promise<TestConnectionResult> {
    try {
      const client = await this.getClient();
      await client.db(this.database).command({ ping: 1 });
      if (includeSchema) {
        const schemas = await this.collectSchema(client);
        return { success: true, message: 'Connection successful', schema: { schemas } };
      }
      return { success: true, message: 'Connection successful' };
    } catch (err: any) {
      return { success: false, message: err?.message || String(err) };
    }
  }

  async query(sql: string): Promise<QueryResult> {
    const client = await this.getClient();
    const queryLeaf = new QueryLeaf(client, this.database);
    const result = await queryLeaf.execute(sql);
    const rows = (Array.isArray(result) ? result : []) as Record<string, unknown>[];
    const { columns, types } = documentsToQueryResultColumns(rows);
    // Mongo connector doesn't accept `:name` params — queryleaf takes SQL
    // as-is — so `finalQuery` is literally the input SQL.
    return { columns, types, rows, finalQuery: sql };
  }

  async getSchema(): Promise<SchemaEntry[]> {
    const client = await this.getClient();
    return this.collectSchema(client);
  }

  private async collectSchema(client: MongoClient): Promise<SchemaEntry[]> {
    const db = client.db(this.database);
    const collections = await db.listCollections().toArray();
    const tables = await Promise.all(
      collections.map(async (c) => {
        const sample = await db.collection(c.name).findOne();
        const cols = sample
          ? Object.entries(sample)
              .filter(([k]) => k !== '_id')
              .map(([k, v]) => ({ name: k, type: inferSqlType(v) }))
          : [];
        return { table: c.name, columns: cols };
      }),
    );
    return [{ schema: this.database, tables }];
  }
}
