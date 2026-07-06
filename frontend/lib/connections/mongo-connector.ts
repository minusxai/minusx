import 'server-only';
import { MongoClient } from 'mongodb';
import { NodeConnector, SchemaEntry, QueryResult, QueryStream } from './base';
import { DEFAULT_LIMIT, MAX_LIMIT } from '@/lib/sql/limit-enforcer';

/**
 * Node.js MongoDB connector.
 *
 * Executes **native MongoDB aggregation pipelines** — the `query` string is
 * JSON of the form `{"collection": "...", "pipeline": [...stages]}`, run
 * directly via `db.collection(c).aggregate(pipeline)`. The aggregation
 * framework is the universal Mongo read interface (`find`, `count`,
 * `distinct`, `$lookup` joins are all expressible as pipeline stages).
 *
 * Schema inference samples up to 100 documents per collection (Mongo is
 * schemaless) and unions the field sets seen.
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
 * Project a list of BSON documents (an aggregation result) onto a
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

/**
 * Cap an aggregation pipeline's result size, mirroring the SQL
 * `enforceQueryLimit` contract (default 1000 rows, hard ceiling 10000).
 * Applied at the END of the pipeline:
 *  - a terminal `$limit` is the row cap — clamped to `maxLimit`, otherwise
 *    left as-is (a deliberately small terminal limit is honoured);
 *  - any other final stage → a `{$limit: defaultLimit}` is appended;
 *  - an early (non-terminal) `$limit` is a deliberate sub-step — untouched.
 * Pure — returns a new array, never mutates the input.
 */
export function enforceMongoLimit(
  pipeline: ReadonlyArray<Record<string, unknown>>,
  defaultLimit: number = DEFAULT_LIMIT,
  maxLimit: number = MAX_LIMIT,
): Record<string, unknown>[] {
  const last = pipeline[pipeline.length - 1];
  if (last && typeof last.$limit === 'number') {
    return last.$limit > maxLimit
      ? [...pipeline.slice(0, -1), { $limit: maxLimit }]
      : [...pipeline];
  }
  return [...pipeline, { $limit: defaultLimit }];
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

  protected async ping(): Promise<void> {
    const client = await this.getClient();
    await client.db(this.database).command({ ping: 1 });
  }

  /**
   * Execute a native MongoDB aggregation pipeline.
   *
   * `query` is a JSON string `{"collection": "...", "pipeline": [...stages]}`.
   * `params` is unused (Mongo has no `:name` substitution). `timeoutMs`, when
   * set, is passed through as the aggregation's `maxTimeMS`.
   */
  /** Parse + validate the JSON query and enforce the row cap. Shared by query()/queryStream(). */
  private parsePipeline(query: string): { collection: string; cappedPipeline: Record<string, unknown>[]; finalQuery: string } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(query);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `MongoDB query must be a JSON string of the form {"collection": "...", "pipeline": [...]}. JSON parse failed: ${msg}`,
      );
    }
    const { collection, pipeline } = (parsed ?? {}) as { collection?: unknown; pipeline?: unknown };
    if (typeof collection !== 'string' || collection.length === 0) {
      throw new Error('MongoDB query JSON must have a non-empty string "collection" field.');
    }
    if (!Array.isArray(pipeline)) {
      throw new Error('MongoDB query JSON must have an array "pipeline" field (a list of aggregation stages).');
    }
    const cappedPipeline = enforceMongoLimit(pipeline as Record<string, unknown>[]);
    return { collection, cappedPipeline, finalQuery: JSON.stringify({ collection, pipeline: cappedPipeline }) };
  }

  async query(
    query: string,
    _params?: Record<string, string | number>,
    timeoutMs?: number,
  ): Promise<QueryResult> {
    const { collection, cappedPipeline, finalQuery } = this.parsePipeline(query);
    const client = await this.getClient();
    const options = timeoutMs && timeoutMs > 0 ? { maxTimeMS: timeoutMs } : {};
    const rows = (await client
      .db(this.database)
      .collection(collection)
      .aggregate(cappedPipeline, options)
      .toArray()) as Record<string, unknown>[];

    const { columns, types } = documentsToQueryResultColumns(rows);
    return { columns, types, rows, finalQuery };
  }

  /**
   * Streaming variant — iterates the aggregation cursor so documents are yielded
   * as Mongo produces them (cursor closed in the generator's finally). Mongo is
   * schemaless, so columns/types are sampled from the first batch of documents
   * (the common case where the pipeline output is uniform); every document's
   * full set of fields still flows through in the row objects.
   */
  override async queryStream(
    query: string,
    _params?: Record<string, string | number>,
    timeoutMs?: number,
  ): Promise<QueryStream> {
    const { collection, cappedPipeline, finalQuery } = this.parsePipeline(query);
    const client = await this.getClient();
    const options = timeoutMs && timeoutMs > 0 ? { maxTimeMS: timeoutMs } : {};
    const cursor = client.db(this.database).collection(collection).aggregate(cappedPipeline, options);

    try {
      // Sample the first documents to derive columns (schemaless → no schema up front).
      const SAMPLE = 200;
      const sample: Record<string, unknown>[] = [];
      while (sample.length < SAMPLE && (await cursor.hasNext())) {
        sample.push((await cursor.next()) as Record<string, unknown>);
      }
      const { columns, types } = documentsToQueryResultColumns(sample);

      async function* rows(): AsyncGenerator<Record<string, unknown>> {
        try {
          for (const doc of sample) yield doc;
          for await (const doc of cursor) yield doc as Record<string, unknown>;
        } finally {
          await cursor.close().catch(() => { /* ignore */ });
        }
      }

      return { columns, types, finalQuery, rows: rows() };
    } catch (err) {
      await cursor.close().catch(() => { /* ignore */ });
      throw err;
    }
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
        // Mongo is schemaless — sample up to 100 docs and union their
        // field sets so optional fields (absent from any single doc)
        // still surface. `documentsToQueryResultColumns` does the union
        // + per-column type inference.
        const sample = (await db
          .collection(c.name)
          .aggregate([{ $sample: { size: 100 } }])
          .toArray()) as Record<string, unknown>[];
        const { columns, types } = documentsToQueryResultColumns(sample);
        const cols = columns
          .map((name, i) => ({ name, type: types[i] }))
          .filter((col) => col.name !== '_id');
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
