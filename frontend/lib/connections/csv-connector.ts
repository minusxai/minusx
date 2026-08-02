import 'server-only';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, readdirSync, unlinkSync } from 'fs';
import { getQueryHash } from '@/lib/utils/query-hash';
import {
  OBJECT_STORE_BUCKET,
  OBJECT_STORE_REGION,
  OBJECT_STORE_ACCESS_KEY_ID,
  OBJECT_STORE_SECRET_ACCESS_KEY,
  OBJECT_STORE_ENDPOINT,
  LOCAL_UPLOAD_PATH,
  STATIC_DATASETS_BASE_URL,
} from '@/lib/config';
import { NodeConnector, SchemaEntry, QueryResult, QueryStream } from './base';
import { duckDbStreamFromConn } from './duckdb-stream';
import { inlineSqlParams } from '@/lib/sql/inline-params';
import { resolveObjectKey } from '@/lib/object-store';

// ---------------------------------------------------------------------------
// Config shape
// ---------------------------------------------------------------------------

interface CsvFileEntry {
  table_name: string;
  schema_name: string;
  /** Uploaded object in the store; resolved through resolveObjectKey. */
  s3_key?: string;
  /** Published dataset name; read from ${STATIC_DATASETS_BASE_URL}/${dataset}/${table_name}.parquet. */
  dataset?: string;
  file_format: 'csv' | 'parquet';
  row_count: number;
  columns: Array<{ name: string; type: string }>;
}

interface CsvConnectionConfig {
  files: CsvFileEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Make rows JSON-safe: BigInt → Number/string, Date values are preserved as
// JSON.stringify handles them natively.
function makeJsonSafe(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return JSON.parse(
    JSON.stringify(rows, (_, v) => {
      if (typeof v === 'bigint') {
        return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER)
          ? Number(v)
          : v.toString();
      }
      return v;
    })
  );
}

// ---------------------------------------------------------------------------
// Static datasets — published, read-only files addressed by name
// ---------------------------------------------------------------------------

/** Both become URL path segments, so nothing outside this set may pass. */
const DATASET_IDENT = /^[A-Za-z0-9_-]+$/;

/**
 * The URL a static entry is read from. `dataset` and `table_name` come from the
 * connection document, so they are validated as bare identifiers before being
 * joined into a path; the base comes from server config only — a connection
 * document can never point the connector at an arbitrary host.
 */
export function staticFileUrl(file: CsvFileEntry, baseUrl: string): string {
  if (!file.dataset || !DATASET_IDENT.test(file.dataset)) {
    throw new Error(`Invalid dataset name: ${JSON.stringify(file.dataset)}`);
  }
  if (!DATASET_IDENT.test(file.table_name)) {
    throw new Error(`Invalid table name for static dataset: ${JSON.stringify(file.table_name)}`);
  }
  if (file.file_format !== 'parquet') {
    throw new Error(`Static datasets are parquet-only, got: ${file.file_format}`);
  }
  return `${baseUrl.replace(/\/+$/, '')}/${file.dataset}/${file.table_name}.parquet`;
}

/**
 * Static entries are MATERIALIZED, uploaded objects stay views. A view re-reads
 * the file on every query — for a dataset fetched over the network that multiplies
 * into a full re-download per dashboard tile, which is what made the sample-data
 * dashboard time out. Materializing at init pays the fetch once per process; the
 * instance cache already scopes that to one instance per config.
 */
export function createRelationSql(file: CsvFileEntry, fileUrl: string): string {
  const readExpr = file.file_format === 'parquet'
    ? `read_parquet('${fileUrl}')`
    : `read_csv_auto('${fileUrl}')`;
  const relation = `"${file.schema_name}"."${file.table_name}"`;
  return file.dataset
    ? `CREATE OR REPLACE TABLE ${relation} AS SELECT * FROM ${readExpr}`
    : `CREATE OR REPLACE VIEW ${relation} AS SELECT * FROM ${readExpr}`;
}

/**
 * On-disk home for a static-dataset instance. Keyed by config hash AND pid:
 * DuckDB is single-writer per file, so two processes with the same config (dev
 * server + tests) must not share one. Files from previous runs of THIS config
 * are deleted best-effort — on POSIX an open file survives its unlink, so a
 * still-live sibling process is unaffected; anything else was left by a dead
 * process and would otherwise pile up ~140 MB per restart until tmp cleanup.
 */
function staticInstancePath(cacheKey: string): string {
  const dir = join(tmpdir(), 'mx-static-datasets');
  mkdirSync(dir, { recursive: true });
  const hash = getQueryHash(cacheKey, {}, 'static-datasets');
  try {
    for (const f of readdirSync(dir)) {
      if (f.startsWith(`${hash}-`) && !f.startsWith(`${hash}-${process.pid}.`)) {
        unlinkSync(join(dir, f));
      }
    }
  } catch { /* cleanup is opportunistic */ }
  return join(dir, `${hash}-${process.pid}.duckdb`);
}

// ---------------------------------------------------------------------------
// Instance cache — one DuckDB per unique config hash (in-memory for view-only
// configs; temp-file-backed when static datasets are materialized into it)
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-restricted-syntax -- server-only; keyed by config hash (unique per connection config)
const instanceCache = new Map<string, DuckDBInstance>();
// eslint-disable-next-line no-restricted-syntax -- server-only; prevents duplicate init races
const initPromises = new Map<string, Promise<DuckDBInstance>>();

async function initInstance(
  cacheKey: string,
  files: CsvFileEntry[]
): Promise<DuckDBInstance> {
  const isLocal = !OBJECT_STORE_ACCESS_KEY_ID || !OBJECT_STORE_BUCKET;
  const hasStatic = files.some((f) => f.dataset);
  const hasHttpStatic = hasStatic && STATIC_DATASETS_BASE_URL.startsWith('http');
  // Static datasets materialize real tables, and fully in-memory those cost RAM
  // proportional to the dataset (measured ~1.1 GB for the sample data) — a floor,
  // not a cache. A temp-file-backed instance keeps the rows on local disk with the
  // buffer pool as the cache, bounded below. View-only configs stay ':memory:'.
  const instance = await DuckDBInstance.create(
    hasStatic ? staticInstancePath(cacheKey) : ':memory:',
  );
  const conn = await instance.connect();
  try {
    if (hasStatic) {
      await conn.run(`SET memory_limit = '512MB'`);
    }
    if (!isLocal || hasHttpStatic) {
      // Install and load httpfs — S3 access for uploaded objects, plain HTTP(S)
      // for static datasets. Static reads need it even with no object store
      // configured, which is why this is not gated on isLocal alone.
      await conn.run('INSTALL httpfs');
      await conn.run('LOAD httpfs');
    }
    if (!isLocal) {
      // Configure S3 credentials
      await conn.run(`SET s3_region = '${OBJECT_STORE_REGION}'`);
      if (OBJECT_STORE_ACCESS_KEY_ID) {
        await conn.run(`SET s3_access_key_id = '${OBJECT_STORE_ACCESS_KEY_ID}'`);
      }
      if (OBJECT_STORE_SECRET_ACCESS_KEY) {
        await conn.run(`SET s3_secret_access_key = '${OBJECT_STORE_SECRET_ACCESS_KEY}'`);
      }
      if (OBJECT_STORE_ENDPOINT) {
        await conn.run(`SET s3_endpoint = '${OBJECT_STORE_ENDPOINT}'`);
        await conn.run("SET s3_url_style = 'path'");
      }
    }

    // Create schemas, then a relation per file: static datasets materialize as
    // tables (fetched once, here), uploaded objects stay views over the store.
    const schemas = new Set<string>();
    for (const file of files) {
      if (!schemas.has(file.schema_name)) {
        await conn.run(`CREATE SCHEMA IF NOT EXISTS "${file.schema_name}"`);
        schemas.add(file.schema_name);
      }

      let fileUrl: string;
      if (file.dataset) {
        fileUrl = staticFileUrl(file, STATIC_DATASETS_BASE_URL);
      } else {
        // resolveObjectKey, not the raw s3_key: DuckDB reads the object itself rather than
        // going through the store, so it has to apply the SAME prefix the store applied on
        // write. Joining the logical key directly looks right and reads the wrong directory
        // — the file is there, just not where this looked.
        const physicalKey = await resolveObjectKey(file.s3_key ?? '');
        fileUrl = isLocal
          ? join(LOCAL_UPLOAD_PATH, physicalKey)
          : `s3://${OBJECT_STORE_BUCKET ?? ''}/${physicalKey}`;
      }

      await conn.run(createRelationSql(file, fileUrl));
    }

    // Lock down DuckDB access to the storage prefix of the uploaded files only.
    // allowed_directories must be set BEFORE disabling external access.
    // Also from the PHYSICAL key: the allow-list has to name the directory the reads
    // actually target, or every read is refused once external access is disabled.
    // Static entries need no allowance: their rows were materialized above, so
    // after this lockdown the instance touches nothing outside itself for them.
    const firstUpload = files.find((f) => !f.dataset && f.s3_key);
    const storagePrefix = firstUpload
      ? (await resolveObjectKey(firstUpload.s3_key!)).split('/')[0]
      : '';
    if (isLocal && storagePrefix) {
      await conn.run(`SET allowed_directories = ['${join(LOCAL_UPLOAD_PATH, storagePrefix)}/']`);
    } else if (!isLocal && OBJECT_STORE_BUCKET && storagePrefix) {
      await conn.run(`SET allowed_directories = ['s3://${OBJECT_STORE_BUCKET}/${storagePrefix}/']`);
    }
    await conn.run('SET enable_external_access = false');
  } finally {
    conn.closeSync();
  }

  instanceCache.set(cacheKey, instance);
  return instance;
}

async function getOrCreateInstance(
  cacheKey: string,
  files: CsvFileEntry[]
): Promise<DuckDBInstance> {
  if (instanceCache.has(cacheKey)) return instanceCache.get(cacheKey)!;
  if (initPromises.has(cacheKey)) return initPromises.get(cacheKey)!;

  const p = initInstance(cacheKey, files).catch((err) => {
    initPromises.delete(cacheKey);
    throw err;
  });
  initPromises.set(cacheKey, p);
  const instance = await p;
  initPromises.delete(cacheKey);
  return instance;
}

async function withConnection<T>(
  cacheKey: string,
  files: CsvFileEntry[],
  fn: (conn: DuckDBConnection) => Promise<T>
): Promise<T> {
  const instance = await getOrCreateInstance(cacheKey, files);
  const conn = await instance.connect();
  try {
    return await fn(conn);
  } finally {
    conn.closeSync();
  }
}

// ---------------------------------------------------------------------------
// CsvConnector
// ---------------------------------------------------------------------------

export class CsvConnector extends NodeConnector {
  private readonly files: CsvFileEntry[];
  private readonly cacheKey: string;

  constructor(name: string, config: Record<string, any>) {
    super(name, config);
    const typedConfig = config as CsvConnectionConfig;
    this.files = typedConfig.files ?? [];
    // Stable cache key — same files array → same DuckDB instance
    this.cacheKey = JSON.stringify(this.files);
  }

  protected async ping(): Promise<void> {
    await withConnection(this.cacheKey, this.files, async (conn) => {
      await conn.run('SELECT 1');
    });
  }

  async query(sql: string, params?: Record<string, string | number>): Promise<QueryResult> {
    return withConnection(this.cacheKey, this.files, async (conn) => {
      // Replace named params (:name) with positional $1, $2, ... (DuckDB syntax)
      const paramValues: unknown[] = [];
      const positionalSql = sql.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
        paramValues.push(params?.[key] ?? null);
        return `$${paramValues.length}`;
      });

      const finalQuery = inlineSqlParams(sql, params);

      const result = await conn.run(positionalSql, paramValues as never);
      const colCount = result.columnCount;
      const columns: string[] = [];
      const types: string[] = [];
      for (let i = 0; i < colCount; i++) {
        columns.push(result.columnName(i));
        types.push(result.columnType(i).toString());
      }
      const rawRows = (await result.getRowObjectsJS()) as Record<string, unknown>[];
      const rows = makeJsonSafe(rawRows);
      return { columns, types, rows, finalQuery };
    });
  }

  /** Streaming variant — chunk-by-chunk via the shared DuckDB streaming helper. */
  override async queryStream(sql: string, params?: Record<string, string | number>): Promise<QueryStream> {
    const instance = await getOrCreateInstance(this.cacheKey, this.files);
    const conn = await instance.connect();
    // Same :name → $N substitution as query() above.
    const values: unknown[] = [];
    const positionalSql = sql.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
      values.push(params?.[key] ?? null);
      return `$${values.length}`;
    });
    return duckDbStreamFromConn({
      conn, positionalSql, values, finalQuery: inlineSqlParams(sql, params),
      onClose: () => conn.closeSync(),
    });
  }

  async getSchema(): Promise<SchemaEntry[]> {
    // Return schema directly from config — no DB introspection needed
    const schemaMap = new Map<string, Array<{ table: string; columns: Array<{ name: string; type: string }> }>>();

    for (const file of this.files) {
      if (!schemaMap.has(file.schema_name)) {
        schemaMap.set(file.schema_name, []);
      }
      schemaMap.get(file.schema_name)!.push({
        table: file.table_name,
        columns: file.columns,
      });
    }

    return Array.from(schemaMap.entries()).map(([schema, tables]) => ({
      schema,
      tables,
    }));
  }
}
