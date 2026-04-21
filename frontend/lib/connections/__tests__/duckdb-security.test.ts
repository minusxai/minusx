/**
 * TDD security tests for DuckDB external-access controls.
 *
 * Red phase  : "[RED]" tests confirm the vulnerability exists BEFORE the fix.
 * Green phase: "[GREEN]" tests confirm the fix works AFTER it is applied.
 *
 * These tests exercise the DuckDB Node.js binding directly — no connector
 * mocks, no Next.js plumbing — so they validate DuckDB's own security model.
 *
 * Run: cd frontend && npx jest duckdb-security --no-coverage
 */

import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { mkdirSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

async function tryClose(inst: DuckDBInstance) {
  try { inst.closeSync(); } catch { /* ignore */ }
}

// ── Analytics DB (file-based, READ_ONLY) ────────────────────────────────────

describe('Analytics DB security (file-based DuckDB)', () => {
  let instance: DuckDBInstance;
  let tmpDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'duckdb-sec-analytics-'));
    dbPath = join(tmpDir, '42.duckdb');
    instance = await DuckDBInstance.create(dbPath);
    const conn = await instance.connect();
    try {
      await conn.run('CREATE TABLE company_data (id INT, revenue DOUBLE)');
      await conn.run('INSERT INTO company_data VALUES (1, 1000.0)');
    } finally {
      conn.closeSync();
    }
  });

  afterEach(() => tryClose(instance));

  // ── Red: prove vulnerability exists ──

  it('[RED] read_csv_auto reads arbitrary local files without protection', async () => {
    const csvPath = join(tmpDir, 'secrets.csv');
    writeFileSync(csvPath, 'secret\npassword123\n');
    const conn = await instance.connect();
    try {
      const result = await conn.run(`SELECT * FROM read_csv_auto('${csvPath}')`);
      const rows = await result.getRowObjectsJS();
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      conn.closeSync();
    }
  });

  // ── Green: with fix applied ──

  it('[GREEN] read_csv_auto on arbitrary local path is blocked', async () => {
    const csvPath = join(tmpDir, 'secrets.csv');
    writeFileSync(csvPath, 'secret\npassword123\n');
    const conn = await instance.connect();
    try {
      // allowed_paths must be set BEFORE enable_external_access = false
      await conn.run(`SET allowed_paths = ['${dbPath}']`);
      await conn.run("SET enable_external_access = false");
      await expect(
        conn.run(`SELECT * FROM read_csv_auto('${csvPath}')`)
      ).rejects.toThrow();
    } finally {
      conn.closeSync();
    }
  });

  it('[GREEN] ATTACH to another DB file is blocked', async () => {
    const otherDb = join(tmpDir, '99.duckdb');
    const conn = await instance.connect();
    try {
      await conn.run(`SET allowed_paths = ['${dbPath}']`);
      await conn.run("SET enable_external_access = false");
      await expect(
        conn.run(`ATTACH '${otherDb}' AS other`)
      ).rejects.toThrow();
    } finally {
      conn.closeSync();
    }
  });

  it('[GREEN] glob is blocked', async () => {
    const conn = await instance.connect();
    try {
      await conn.run(`SET allowed_paths = ['${dbPath}']`);
      await conn.run("SET enable_external_access = false");
      await expect(
        conn.run(`SELECT * FROM glob('${tmpDir}/**')`)
      ).rejects.toThrow();
    } finally {
      conn.closeSync();
    }
  });

  it('[GREEN] normal table queries still work after protection is applied', async () => {
    const conn = await instance.connect();
    try {
      await conn.run(`SET allowed_paths = ['${dbPath}']`);
      await conn.run("SET enable_external_access = false");
      const result = await conn.run('SELECT * FROM company_data');
      const rows = await result.getRowObjectsJS() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(1);
    } finally {
      conn.closeSync();
    }
  });

  it('[GREEN] security settings persist on a second connection — no re-apply needed', async () => {
    // Regression: applying SET statements per-connection fails on the 2nd call
    // because enable_external_access is instance-level and can't be changed once set.
    const csvPath = join(tmpDir, 'secrets.csv');
    writeFileSync(csvPath, 'secret\npassword123\n');

    // First connection: apply settings once
    const conn1 = await instance.connect();
    try {
      await conn1.run(`SET allowed_paths = ['${dbPath}']`);
      await conn1.run("SET enable_external_access = false");
    } finally {
      conn1.closeSync();
    }

    // Second connection: must NOT re-apply settings (would throw), but still be protected
    const conn2 = await instance.connect();
    try {
      await expect(
        conn2.run(`SELECT * FROM read_csv_auto('${csvPath}')`)
      ).rejects.toThrow();
      // Normal queries still work
      const result = await conn2.run('SELECT * FROM company_data');
      const rows = await result.getRowObjectsJS() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
    } finally {
      conn2.closeSync();
    }
  });
});

// ── CSV/Parquet connection (in-memory DuckDB with allowed_directories) ────────

describe('CSV connection security (in-memory DuckDB)', () => {
  let instance: DuckDBInstance;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'duckdb-sec-csv-'));
    instance = await DuckDBInstance.create(':memory:');
  });

  afterEach(() => tryClose(instance));

  // ── Red: prove vulnerability exists ──

  it('[RED] read_csv_auto reads arbitrary local files without protection', async () => {
    const csvPath = join(tmpDir, 'secrets.csv');
    writeFileSync(csvPath, 'secret\npassword123\n');
    const conn = await instance.connect();
    try {
      const result = await conn.run(`SELECT * FROM read_csv_auto('${csvPath}')`);
      const rows = await result.getRowObjectsJS();
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      conn.closeSync();
    }
  });

  // ── Green: with fix applied ──

  it('[GREEN] allowed_directories permits org prefix, blocks everything else', async () => {
    const companyDir = join(tmpDir, 'company_42');
    mkdirSync(companyDir);
    const otherDir = join(tmpDir, 'company_99');
    mkdirSync(otherDir);
    writeFileSync(join(companyDir, 'data.csv'), 'a,b\n1,2\n3,4\n');
    writeFileSync(join(otherDir, 'data.csv'), 'a,b\n5,6\n');

    const conn = await instance.connect();
    try {
      // allowed_directories must be set BEFORE enable_external_access = false
      await conn.run(`SET allowed_directories = ['${companyDir}/']`);
      await conn.run("SET enable_external_access = false");

      // Org's own prefix → allowed
      const result = await conn.run(`SELECT * FROM read_csv_auto('${join(companyDir, 'data.csv')}')`);
      const rows = await result.getRowObjectsJS();
      expect(rows).toHaveLength(2);

      // Other org's prefix → blocked
      await expect(
        conn.run(`SELECT * FROM read_csv_auto('${join(otherDir, 'data.csv')}')`)
      ).rejects.toThrow();
    } finally {
      conn.closeSync();
    }
  });

  it('[GREEN] ATTACH to a file outside allowed_directories is blocked', async () => {
    const companyDir = join(tmpDir, 'company_42');
    mkdirSync(companyDir);
    const otherDir = join(tmpDir, 'company_99');
    mkdirSync(otherDir);

    // Create another org's DuckDB file with data
    const otherDb = join(otherDir, '99.duckdb');
    const otherInst = await DuckDBInstance.create(otherDb);
    const otherConn = await otherInst.connect();
    await otherConn.run("CREATE TABLE secret (data VARCHAR); INSERT INTO secret VALUES ('classified')");
    otherConn.closeSync();
    otherInst.closeSync();

    const conn = await instance.connect();
    try {
      await conn.run(`SET allowed_directories = ['${companyDir}/']`);
      await conn.run("SET enable_external_access = false");
      await expect(
        conn.run(`ATTACH '${otherDb}' AS other`)
      ).rejects.toThrow();
    } finally {
      conn.closeSync();
    }
  });

  it('[GREEN] arbitrary local path read is blocked even when allowed_directories is set', async () => {
    const companyDir = join(tmpDir, 'company_42');
    mkdirSync(companyDir);
    const secretCsv = join(tmpDir, 'secrets.csv');
    writeFileSync(secretCsv, 'secret\npassword123\n');

    const conn = await instance.connect();
    try {
      await conn.run(`SET allowed_directories = ['${companyDir}/']`);
      await conn.run("SET enable_external_access = false");
      await expect(
        conn.run(`SELECT * FROM read_csv_auto('${secretCsv}')`)
      ).rejects.toThrow();
    } finally {
      conn.closeSync();
    }
  });
});
