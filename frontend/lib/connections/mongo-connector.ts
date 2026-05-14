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

  constructor(name: string, config: Record<string, any>) {
    super(name, config);
    const c = config as MongoConfig;
    this.uri = buildMongoUri(c);
    this.database = c.database;
  }

  private getClient(): Promise<MongoClient> {
    return getSharedMongoClient(this.uri);
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
    const rewrittenSql = rewriteForQueryleaf(sql);
    const result = await queryLeaf.execute(rewrittenSql);
    const rows = (Array.isArray(result) ? result : []) as Record<string, unknown>[];
    const { columns, types } = documentsToQueryResultColumns(rows);
    // Mongo connector doesn't accept `:name` params — queryleaf takes SQL
    // as-is — so `finalQuery` reflects what queryleaf actually ran, which
    // may differ from `sql` by the queryleaf-compat rewrites applied below.
    return { columns, types, rows, finalQuery: rewrittenSql };
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

/**
 * Process-wide cache of MongoClient promises keyed by Mongo URI.
 *
 * Background: `MongoConnector` is constructed fresh on every
 * `ExecuteQuery` / `SearchDBSchema` invocation (`shared-duckdb.ts`
 * falls through to `getNodeConnector` for non-attachable dialects).
 * Each fresh connector opened a brand-new `MongoClient`, which opens a
 * fresh socket pool (default `maxPoolSize=100`). Connectors went out of
 * scope after their tool call but their MongoClient sockets stayed
 * alive until heartbeat timeout — so under benchmark load (rows ×
 * `DAB_TIMES_RUN` × DoubleCheck rounds × per-row tool calls), Mongo's
 * connection count climbed into the thousands and the container OOM'd
 * with `connect ECONNREFUSED` once it stopped accepting new sockets.
 *
 * Fix: process-wide singleton per URI, mirroring the DuckDB pattern in
 * `shared-duckdb.ts::getOrCreateBenchmarkConnector`. All
 * MongoConnectors pointing at the same Mongo share one MongoClient
 * (and therefore one socket pool capped at `maxPoolSize`). Lifetime is
 * the process — no explicit `client.close()` because (a) closing per
 * call races the driver's session lifecycle (MongoExpiredSessionError)
 * and (b) the benchmark CLI exits when it's done; for v=2 chat the
 * Node process is long-lived and a stable client per Mongo URI is
 * exactly what `mongodb`'s authors recommend.
 */
// eslint-disable-next-line no-restricted-syntax -- intentional process-wide singleton cache: connection-pool sharing across requests is the whole point. Key is the full Mongo URI (host:port/db + credentials), so cross-tenant collisions are impossible; entries are immutable promises (MongoClient instances live for the process lifetime by mongodb-driver design).
const sharedMongoClients = new Map<string, Promise<MongoClient>>();

function getSharedMongoClient(uri: string): Promise<MongoClient> {
  let p = sharedMongoClients.get(uri);
  if (!p) {
    p = new MongoClient(uri).connect();
    sharedMongoClients.set(uri, p);
  }
  return p;
}

/**
 * Rewrite SQL fragments the LLM emits so queryleaf can parse them.
 * queryleaf's dialect is its own thing — it accepts some non-standard
 * forms (e.g. `!= null`) but rejects standard ones (`IS NOT NULL`,
 * `REGEXP`). Rather than prompt-engineer around its quirks per call,
 * we normalise SQL into the operators it does support before handing
 * it off.
 *
 * Rewrites:
 *   - `IS NOT NULL` → `!= NULL`  (queryleaf throws "Unsupported
 *     operator: IS NOT" on the standard form, even though it accepts
 *     the non-standard `!= NULL`).
 *   - `IS NULL`     → `= NULL`   (symmetric.)
 *   - `REGEXP`      → `~`        (queryleaf supports Postgres-style
 *     regex operators `~` / `~*` per its own parser error message but
 *     not the MySQL `REGEXP` keyword. `~` is the case-sensitive
 *     equivalent of `REGEXP`.)
 *
 * Implementation is regex rather than AST round-trip because:
 *  - queryleaf has its own non-standard dialect, so a standard JS SQL
 *    parser can't safely parse what queryleaf will run;
 *  - rewrites are operator-level, not structural surgery;
 *  - the SQL is exclusively LLM-generated — false-positives on the
 *    literal strings `'IS NOT NULL'` / `'REGEXP'` inside quoted values
 *    are vanishingly unlikely in practice and would at worst surface
 *    as a queryleaf error the agent recovers from on its next turn.
 *
 * Word boundaries (`\b`) prevent matches inside identifiers like
 * `IS_NOT_NULLABLE`. `\s+` matches arbitrary inter-token whitespace
 * including newlines. Case-insensitive flag handles every casing.
 */
function rewriteForQueryleaf(sql: string): string {
  return sql
    .replace(/\bIS\s+NOT\s+NULL\b/gi, '!= NULL')
    .replace(/\bIS\s+NULL\b/gi,       '= NULL')
    .replace(/\bREGEXP\b/gi,          '~');
}
