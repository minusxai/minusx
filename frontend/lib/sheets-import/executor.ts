import 'server-only';

/**
 * Transform executor — stages 2+3 of the agentic Sheets import (see types.ts).
 *
 * Runs agent-authored DuckDB SQL over the raw grids mounted as `raw.<table>` views:
 *  - `previewTransform` — bounded rows + schema + total count, for the agent's own
 *    validate-and-repair loop and for the review UI;
 *  - `materializeTransforms` — writes each transform's full result to Parquet and returns
 *    the same RegisteredFile shape as the plain CSV path, so registration on the static
 *    connection, schema browsing, and profiling all work unchanged. Atomic: on any failure
 *    every Parquet written by the call is deleted before the error surfaces.
 *
 * Sandbox: the DuckDB instance can only read the connection's own storage prefix
 * (`allowed_directories` + `enable_external_access = false`, mirroring CsvConnector), so
 * agent SQL cannot touch anything outside the imported sheet data.
 */

import { randomUUID } from 'crypto';
import { mkdirSync, readFileSync, unlinkSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { tmpdir } from 'os';
import { DuckDBInstance } from '@duckdb/node-api';
import {
  OBJECT_STORE_BUCKET,
  OBJECT_STORE_REGION,
  OBJECT_STORE_ACCESS_KEY_ID,
  OBJECT_STORE_SECRET_ACCESS_KEY,
  OBJECT_STORE_ENDPOINT,
  LOCAL_UPLOAD_PATH,
} from '@/lib/config';
import { createObjectStore, isLocalObjectStore } from '@/lib/object-store';
import { deleteS3File } from '@/lib/csv-processor';
import type { RegisteredFile } from '@/lib/csv-processor';
import type { RawGridFile, SheetTransform, TransformPreview } from './types';

type DuckConn = Awaited<ReturnType<InstanceType<typeof DuckDBInstance>['connect']>>;

function storageUrl(key: string): string {
  if (!isLocalObjectStore()) return `s3://${OBJECT_STORE_BUCKET!}/${key}`;
  return resolve(join(LOCAL_UPLOAD_PATH, key));
}

/**
 * Directories the sandboxed DuckDB may touch. The local temp dir is ALWAYS included:
 * materializeTransforms COPYs to a temp file before store.put in both store modes, so an
 * S3-only allowlist would fail every materialization with a DuckDB Permission Error.
 */
export function sandboxAllowedDirs(mode: string, connectionName: string): string[] {
  const storagePrefix = `csvs/${mode}/${connectionName}`;
  const prefixDir = isLocalObjectStore()
    ? `${join(LOCAL_UPLOAD_PATH, storagePrefix)}/`
    : `s3://${OBJECT_STORE_BUCKET}/${storagePrefix}/`;
  return [prefixDir, `${tmpdir()}/`];
}

/**
 * Open an in-memory DuckDB with every raw grid mounted as `raw."<table_name>"`, locked to the
 * connection's storage prefix, and hand it to `fn`. Always closes the instance.
 */
async function withRawGridDb<T>(
  mode: string,
  connectionName: string,
  rawFiles: RawGridFile[],
  fn: (conn: DuckConn) => Promise<T>,
): Promise<T> {
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    if (!isLocalObjectStore()) {
      await conn.run('INSTALL httpfs');
      await conn.run('LOAD httpfs');
      await conn.run(`SET s3_region = '${OBJECT_STORE_REGION}'`);
      if (OBJECT_STORE_ACCESS_KEY_ID) await conn.run(`SET s3_access_key_id = '${OBJECT_STORE_ACCESS_KEY_ID}'`);
      if (OBJECT_STORE_SECRET_ACCESS_KEY) await conn.run(`SET s3_secret_access_key = '${OBJECT_STORE_SECRET_ACCESS_KEY}'`);
      if (OBJECT_STORE_ENDPOINT) {
        await conn.run(`SET s3_endpoint = '${OBJECT_STORE_ENDPOINT}'`);
        await conn.run("SET s3_url_style = 'path'");
      }
    }
    const allowedDirs = sandboxAllowedDirs(mode, connectionName).map((d) => `'${d}'`).join(', ');
    await conn.run(`SET allowed_directories = [${allowedDirs}]`);

    await conn.run('CREATE SCHEMA IF NOT EXISTS raw');
    for (const f of rawFiles) {
      await conn.run(
        `CREATE OR REPLACE VIEW raw."${f.table_name}" AS SELECT * FROM read_parquet('${storageUrl(f.s3_key)}')`,
      );
    }
    // Lock down AFTER the views exist; agent SQL can then only read what's mounted.
    await conn.run('SET enable_external_access = false');
    return await fn(conn);
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

/** Run an arbitrary read-only SQL over the mounted raw grids (agent sampling / inspection). */
export async function queryRawGrids(
  rawFiles: RawGridFile[],
  sql: string,
  mode = 'org',
  connectionName = 'static',
): Promise<Array<Record<string, unknown>>> {
  return withRawGridDb(mode, connectionName, rawFiles, async (conn) => {
    const res = await conn.run(sql);
    return await res.getRowObjectsJS() as Array<Record<string, unknown>>;
  });
}

/**
 * Run one transform bounded: schema (DESCRIBE), first `limit` rows, and the full row count.
 * SQL errors are thrown as-is — they are the input to the agent's self-repair loop.
 */
export async function previewTransform(
  rawFiles: RawGridFile[],
  transform: SheetTransform,
  limit = 50,
  mode = 'org',
  connectionName = 'static',
): Promise<TransformPreview> {
  return withRawGridDb(mode, connectionName, rawFiles, async (conn) => {
    const viewName = `__preview_${randomUUID().replace(/-/g, '_')}`;
    await conn.run(`CREATE TEMP VIEW "${viewName}" AS ${transform.sql}`);

    const descRes = await conn.run(`DESCRIBE "${viewName}"`);
    const descRows = await descRes.getRowObjectsJS() as Array<{ column_name: string; column_type: string }>;
    const columns = descRows.map(r => ({ name: r.column_name, type: r.column_type }));

    const countRes = await conn.run(`SELECT COUNT(*)::DOUBLE AS cnt FROM "${viewName}"`);
    const countRows = await countRes.getRowObjectsJS() as Array<{ cnt: number }>;

    const rowsRes = await conn.run(`SELECT * FROM "${viewName}" LIMIT ${Math.max(1, Math.floor(limit))}`);
    const rows = await rowsRes.getRowObjectsJS() as Array<Record<string, unknown>>;

    return { columns, rows, row_count: Number(countRows[0]?.cnt ?? 0) };
  });
}

/**
 * Materialize every transform to Parquet under the connection's prefix and return the
 * RegisteredFile records ready to store on the static connection. Atomic: a failure deletes
 * every Parquet this call already wrote, then rethrows.
 */
export async function materializeTransforms(
  mode: string,
  connectionName: string,
  rawFiles: RawGridFile[],
  transforms: SheetTransform[],
): Promise<RegisteredFile[]> {
  const createdKeys: string[] = [];
  const store = createObjectStore();
  try {
    return await withRawGridDb(mode, connectionName, rawFiles, async (conn) => {
      const results: RegisteredFile[] = [];
      for (const t of transforms) {
        const uuid = randomUUID();
        const storageKey = `csvs/${mode}/${connectionName}/${uuid}.parquet`;
        // Materialize via a local temp file, then store through the object-store adapter —
        // identical to the raw-grid path, and keeps DuckDB's write surface to tmpdir only.
        const tmpParquetPath = join(tmpdir(), `${uuid}.parquet`);
        try {
          mkdirSync(dirname(tmpParquetPath), { recursive: true });
          await conn.run(`COPY (${t.sql}) TO '${tmpParquetPath}' (FORMAT PARQUET, COMPRESSION ZSTD)`);
          await store.put(storageKey, readFileSync(tmpParquetPath), 'application/octet-stream');
          createdKeys.push(storageKey);
        } finally {
          try { unlinkSync(tmpParquetPath); } catch { /* ignore */ }
        }

        const metaView = `__meta_${uuid.replace(/-/g, '_')}`;
        await conn.run(`CREATE TEMP VIEW "${metaView}" AS ${t.sql}`);
        const countRes = await conn.run(`SELECT COUNT(*)::DOUBLE AS cnt FROM "${metaView}"`);
        const countRows = await countRes.getRowObjectsJS() as Array<{ cnt: number }>;
        const descRes = await conn.run(`DESCRIBE "${metaView}"`);
        const descRows = await descRes.getRowObjectsJS() as Array<{ column_name: string; column_type: string }>;

        results.push({
          table_name: t.output_table,
          schema_name: t.schema_name,
          s3_key: storageKey,
          file_format: 'parquet',
          filename: `${t.output_table}.parquet`,
          row_count: Number(countRows[0]?.cnt ?? 0),
          columns: descRows.map(r => ({ name: r.column_name, type: r.column_type })),
        });
      }
      return results;
    });
  } catch (err) {
    await Promise.allSettled(createdKeys.map(key => deleteS3File(key)));
    throw err;
  }
}
