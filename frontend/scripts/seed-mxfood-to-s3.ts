#!/usr/bin/env tsx
/**
 * One-time script: download mxfood.duckdb from GitHub releases and upload all
 * tables as Parquet to S3. These become the shared seed files copied per-company
 * at registration time:
 *   seeds/mxfood/{table}.parquet → {companyId}/csvs/tutorial/mxfood/{table}.parquet
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
 *   MXFOOD_DUCKDB_URL                Override download URL (default: GitHub releases)
 */

import { config } from 'dotenv';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile, unlink } from 'fs/promises';
import { DuckDBInstance } from '@duckdb/node-api';

config();

const BUCKET = process.env.OBJECT_STORE_BUCKET;
const REGION = process.env.OBJECT_STORE_REGION ?? 'us-east-1';
const ACCESS_KEY = process.env.OBJECT_STORE_ACCESS_KEY_ID ?? '';
const SECRET_KEY = process.env.OBJECT_STORE_SECRET_ACCESS_KEY ?? '';
const ENDPOINT = process.env.OBJECT_STORE_ENDPOINT ?? '';
const MXFOOD_URL =
  process.env.MXFOOD_DUCKDB_URL ??
  'https://github.com/minusxai/sample_datasets/releases/download/v1.0/mxfood.duckdb';

if (!BUCKET) {
  console.error('ERROR: OBJECT_STORE_BUCKET is not set. Add it to frontend/.env');
  process.exit(1);
}

async function main() {
  // Download mxfood.duckdb to a temp file
  console.log(`Downloading: ${MXFOOD_URL}`);
  const res = await fetch(MXFOOD_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const tmpPath = join(tmpdir(), `mxfood-seed-${Date.now()}.duckdb`);
  await writeFile(tmpPath, buffer);
  console.log(`Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)} MB → ${tmpPath}`);
  console.log(`Uploading to: s3://${BUCKET}/seeds/mxfood/\n`);

  const instance = await DuckDBInstance.create(tmpPath);
  const conn = await instance.connect();

  try {
    await conn.run('INSTALL httpfs');
    await conn.run('LOAD httpfs');
    await conn.run(`SET s3_region = '${REGION}'`);
    if (ACCESS_KEY) await conn.run(`SET s3_access_key_id = '${ACCESS_KEY}'`);
    if (SECRET_KEY) await conn.run(`SET s3_secret_access_key = '${SECRET_KEY}'`);
    if (ENDPOINT) {
      await conn.run(`SET s3_endpoint = '${ENDPOINT}'`);
      await conn.run("SET s3_url_style = 'path'");
    }

    const result = await conn.run(
      "SELECT table_name FROM information_schema.tables " +
      "WHERE table_schema = 'main' AND table_type = 'BASE TABLE' " +
      "ORDER BY table_name"
    );
    const rows = await result.getRowObjectsJS() as Array<{ table_name: string }>;
    const tables = rows.map(r => r.table_name);

    if (tables.length === 0) {
      console.error('No tables found in mxfood.duckdb');
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
    if (failed.length > 0) {
      console.error(`  Failed: ${failed.map(([t]) => t).join(', ')}`);
      process.exit(1);
    }
  } finally {
    conn.closeSync();
    await unlink(tmpPath).catch(() => {}); // clean up temp file
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
