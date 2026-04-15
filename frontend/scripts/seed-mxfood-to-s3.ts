#!/usr/bin/env tsx
/**
 * One-time script: upload all mxfood tables from data/mxfood.duckdb to S3 as Parquet.
 * These become the shared seed files copied per-company at registration time
 * (seeds/mxfood/{table}.parquet → {companyId}/csvs/tutorial/mxfood/{table}.parquet).
 *
 * Usage (run from frontend/):
 *   npm run seed-mxfood
 *
 * Reads env vars from frontend/.env automatically.
 *
 * Required:
 *   OBJECT_STORE_BUCKET              S3 bucket name
 *   OBJECT_STORE_ACCESS_KEY_ID       AWS access key
 *   OBJECT_STORE_SECRET_ACCESS_KEY   AWS secret key
 *
 * Optional:
 *   OBJECT_STORE_REGION              AWS region (default: us-east-1)
 *   OBJECT_STORE_ENDPOINT            Custom endpoint for MinIO/R2 (e.g. http://minio:9000)
 *   BASE_DUCKDB_DATA_PATH            Base dir for DuckDB paths (default: ..)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { DuckDBInstance } from '@duckdb/node-api';

// Load .env from frontend/ — works whether run via `npm run seed-mxfood` or direct tsx invocation
config();

const BUCKET = process.env.OBJECT_STORE_BUCKET;
const REGION = process.env.OBJECT_STORE_REGION ?? 'us-east-1';
const ACCESS_KEY = process.env.OBJECT_STORE_ACCESS_KEY_ID ?? '';
const SECRET_KEY = process.env.OBJECT_STORE_SECRET_ACCESS_KEY ?? '';
const ENDPOINT = process.env.OBJECT_STORE_ENDPOINT ?? '';
const BASE_PATH = process.env.BASE_DUCKDB_DATA_PATH ?? '..';

if (!BUCKET) {
  console.error('ERROR: OBJECT_STORE_BUCKET is not set. Add it to frontend/.env');
  process.exit(1);
}

const dbPath = resolve(BASE_PATH, 'data/mxfood.duckdb');
console.log(`Opening DuckDB: ${dbPath}`);
console.log(`Uploading to:   s3://${BUCKET}/seeds/mxfood/\n`);

async function main() {
  const instance = await DuckDBInstance.create(dbPath);
  const conn = await instance.connect();

  try {
    // Set up S3 access via httpfs
    await conn.run('INSTALL httpfs');
    await conn.run('LOAD httpfs');
    await conn.run(`SET s3_region = '${REGION}'`);
    if (ACCESS_KEY) await conn.run(`SET s3_access_key_id = '${ACCESS_KEY}'`);
    if (SECRET_KEY) await conn.run(`SET s3_secret_access_key = '${SECRET_KEY}'`);
    if (ENDPOINT) {
      await conn.run(`SET s3_endpoint = '${ENDPOINT}'`);
      await conn.run("SET s3_url_style = 'path'");
    }

    // List all tables in main schema
    const result = await conn.run(
      "SELECT table_name FROM information_schema.tables " +
      "WHERE table_schema = 'main' AND table_type = 'BASE TABLE' " +
      "ORDER BY table_name"
    );
    const rows = await result.getRowObjectsJS() as Array<{ table_name: string }>;
    const tables = rows.map(r => r.table_name);

    if (tables.length === 0) {
      console.error('No tables found in main schema of mxfood.duckdb');
      process.exit(1);
    }
    console.log(`Found ${tables.length} tables: ${tables.join(', ')}\n`);

    const succeeded: string[] = [];
    const failed: Array<[string, string]> = [];

    for (const table of tables) {
      const s3Path = `s3://${BUCKET}/seeds/mxfood/${table}.parquet`;
      process.stdout.write(`  ${table} → ${s3Path} ... `);
      try {
        await conn.run(`COPY (SELECT * FROM main."${table}") TO '${s3Path}' (FORMAT PARQUET)`);
        console.log('OK');
        succeeded.push(table);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`FAILED: ${msg}`);
        failed.push([table, msg]);
      }
    }

    console.log(`\nDone. ${succeeded.length}/${tables.length} tables uploaded successfully.`);
    if (succeeded.length > 0) console.log(`  Succeeded: ${succeeded.join(', ')}`);
    if (failed.length > 0) {
      console.error(`  Failed:    ${failed.map(([t]) => t).join(', ')}`);
      process.exit(1);
    }
  } finally {
    conn.closeSync();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
