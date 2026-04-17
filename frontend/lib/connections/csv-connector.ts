import 'server-only';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import {
  OBJECT_STORE_BUCKET,
  OBJECT_STORE_REGION,
  OBJECT_STORE_ACCESS_KEY_ID,
  OBJECT_STORE_SECRET_ACCESS_KEY,
  OBJECT_STORE_ENDPOINT,
} from '@/lib/config';
import { NodeConnector, SchemaEntry, QueryResult, TestConnectionResult } from './base';

// ---------------------------------------------------------------------------
// Config shape
// ---------------------------------------------------------------------------

interface CsvFileEntry {
  table_name: string;
  schema_name: string;
  s3_key: string;
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
// Instance cache — one in-memory DuckDB per unique config hash
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-restricted-syntax -- server-only; keyed by config hash (unique per connection config)
const instanceCache = new Map<string, DuckDBInstance>();
// eslint-disable-next-line no-restricted-syntax -- server-only; prevents duplicate init races
const initPromises = new Map<string, Promise<DuckDBInstance>>();

async function initInstance(
  cacheKey: string,
  files: CsvFileEntry[]
): Promise<DuckDBInstance> {
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    // Install and load httpfs for S3 access
    await conn.run('INSTALL httpfs');
    await conn.run('LOAD httpfs');

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

    // Create schemas and views for each file
    const schemas = new Set<string>();
    for (const file of files) {
      if (!schemas.has(file.schema_name)) {
        await conn.run(`CREATE SCHEMA IF NOT EXISTS "${file.schema_name}"`);
        schemas.add(file.schema_name);
      }

      const bucket = OBJECT_STORE_BUCKET ?? '';
      const s3Url = `s3://${bucket}/${file.s3_key}`;

      let readExpr: string;
      if (file.file_format === 'parquet') {
        readExpr = `read_parquet('${s3Url}')`;
      } else {
        readExpr = `read_csv_auto('${s3Url}')`;
      }

      await conn.run(
        `CREATE OR REPLACE VIEW "${file.schema_name}"."${file.table_name}" AS SELECT * FROM ${readExpr}`
      );
    }

    // Lock down external access to the company's own S3 prefix only.
    // Must be applied after S3 setup and view creation (views reference S3 paths at query time).
    // enable_external_access is instance-level — set once here, persists across all connections.
    // allowed_directories must be set BEFORE disabling external access.
    const companyId = files[0]?.s3_key.split('/')[0] ?? '';
    if (OBJECT_STORE_BUCKET && companyId) {
      await conn.run(`SET allowed_directories = ['s3://${OBJECT_STORE_BUCKET}/${companyId}/']`);
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

  async testConnection(includeSchema = false): Promise<TestConnectionResult> {
    try {
      await withConnection(this.cacheKey, this.files, async (conn) => {
        await conn.run('SELECT 1');
      });

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
    return withConnection(this.cacheKey, this.files, async (conn) => {
      // Replace named params (:name) with positional $1, $2, ... (DuckDB syntax)
      const paramValues: unknown[] = [];
      const positionalSql = sql.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
        paramValues.push(params?.[key] ?? null);
        return `$${paramValues.length}`;
      });

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
      return { columns, types, rows };
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
