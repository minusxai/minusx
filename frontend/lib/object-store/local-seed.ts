import 'server-only';

import { existsSync, mkdirSync, createWriteStream, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { DuckDBInstance } from '@duckdb/node-api';
import { LOCAL_UPLOAD_PATH, MXFOOD_DUCKDB_URL } from '@/lib/config';

function seedPath(tableName: string): string {
  return resolve(join(LOCAL_UPLOAD_PATH, 'seeds', 'mxfood', `${tableName}.parquet`));
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  const stream = createWriteStream(dest);
  const reader = res.body!.getReader();
  await new Promise<void>((ok, fail) => {
    stream.on('error', fail);
    stream.on('finish', ok);
    const pump = (): Promise<void> =>
      reader.read().then(({ done, value }) => {
        if (done) { stream.end(); return; }
        stream.write(Buffer.from(value));
        return pump();
      });
    pump().catch(fail);
  });
}

/**
 * Ensure mxfood seed parquet files exist under LOCAL_UPLOAD_PATH/seeds/mxfood/.
 * Downloads mxfood.duckdb once, exports all requested tables, then deletes the temp DB.
 * Idempotent: skips tables that already exist on disk.
 */
export async function ensureLocalMxfoodSeeds(tableNames: string[]): Promise<void> {
  const missing = tableNames.filter((t) => !existsSync(seedPath(t)));
  if (missing.length === 0) return;

  const tmpDb = join(tmpdir(), `mxfood-${randomUUID()}.duckdb`);
  try {
    console.log(`[local-seed] Downloading mxfood.duckdb for ${missing.length} missing tables…`);
    await downloadFile(MXFOOD_DUCKDB_URL, tmpDb);

    const instance = await DuckDBInstance.create(':memory:');
    const conn = await instance.connect();

    await conn.run(`ATTACH '${tmpDb}' AS mxfood (READ_ONLY)`);

    const seedDir = resolve(join(LOCAL_UPLOAD_PATH, 'seeds', 'mxfood'));
    mkdirSync(seedDir, { recursive: true });

    for (const table of missing) {
      const dest = seedPath(table);
      await conn.run(`COPY mxfood.${table} TO '${dest}' (FORMAT PARQUET)`);
      console.log(`[local-seed] Exported ${table} → ${dest}`);
    }

    conn.closeSync();
    instance.closeSync();
  } finally {
    try { unlinkSync(tmpDb); } catch { /* ignore */ }
  }
}
