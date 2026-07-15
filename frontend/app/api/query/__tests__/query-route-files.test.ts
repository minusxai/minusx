/**
 * The `/api/query` route with the VIRTUAL `files` connection — static data as
 * files, end to end with REAL DuckDB over real local CSV fixtures.
 *
 * What only composes here:
 *   1. `connection_name: "files"` needs no connection doc — it resolves from
 *      the caller's filePath (dataset docs in that folder + its ancestors);
 *   2. tables from DIFFERENT datasets (own folder + an ancestor's) land in ONE
 *      DuckDB session, so they are JOINABLE — the reason datasets share the
 *      virtual connection instead of being one-connection-per-file;
 *   3. a sibling folder's dataset does NOT resolve (visibility never flows
 *      sideways), so querying it fails loudly;
 *   4. hidden tables don't exist for the query surface.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { POST as queryPost } from '@/app/api/query/route';
import { DocumentDB } from '@/lib/database/documents-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import { LOCAL_UPLOAD_PATH } from '@/lib/config';
import { NextRequest } from 'next/server';
import type { DatasetContent, DatasetTable } from '@/lib/types/datasets';

const TEST_DB_PATH = getTestDbPath('query_route_files');
const PREFIX = `dstest-${process.pid}`;

/** Write a real CSV fixture under LOCAL_UPLOAD_PATH and return its table entry. */
function fixture(schema: string, name: string, csv: string): DatasetTable {
  const s3_key = `${PREFIX}/${schema}/${name}.csv`;
  const full = join(LOCAL_UPLOAD_PATH, s3_key);
  mkdirSync(join(LOCAL_UPLOAD_PATH, PREFIX, schema), { recursive: true });
  writeFileSync(full, csv);
  const header = csv.split('\n')[0].split(',');
  return {
    filename: `${name}.csv`, table_name: name, schema_name: schema, s3_key,
    file_format: 'csv', row_count: csv.trim().split('\n').length - 1,
    columns: header.map((c) => ({ name: c, type: 'VARCHAR' })), source: 'upload',
  };
}

async function mkDataset(path: string, tables: DatasetTable[], hiddenTables?: string[]): Promise<number> {
  const content: DatasetContent = { description: null, files: tables, ...(hiddenTables ? { hiddenTables } : {}) };
  const name = path.split('/').pop()!;
  const id = await DocumentDB.create(name, path, 'dataset', content, []);
  await DocumentDB.update(id, name, path, content, [], `init-${id}`);
  return id;
}

async function runViaRoute(query: string, filePath: string) {
  const req = new NextRequest('http://localhost:3000/api/query?mode=org', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': '1' },
    body: JSON.stringify({ query, connection_name: 'files', filePath, parameters: {}, forceRefresh: true }),
  });
  const res = await queryPost(req);
  const text = await res.text();
  // JSONL stream: data rows are JSON per line after the header line
  return { status: res.status, text };
}

describe('/api/query with the virtual files connection (real DuckDB)', () => {
  setupTestDb(TEST_DB_PATH);

  beforeAll(() => {
    mkdirSync(join(LOCAL_UPLOAD_PATH, PREFIX), { recursive: true });
  });
  afterAll(() => {
    rmSync(join(LOCAL_UPLOAD_PATH, PREFIX), { recursive: true, force: true });
  });

  beforeEach(async () => {
    await getModules().db.exec('DELETE FROM files', []);
    // Root dataset: zones (org-wide reference data).
    await mkDataset('/org/reference', [
      fixture('public', 'zones', 'zone_id,zone_name\n1,North\n2,South'),
    ]);
    // Sales dataset: deals, joinable with root zones.
    await mkDataset('/org/sales/pipeline', [
      fixture('sales', 'deals', 'deal_id,zone_id,amount\n10,1,100\n11,1,250\n12,2,50'),
    ]);
    // Sibling (marketing) dataset — must NOT be reachable from sales.
    await mkDataset('/org/marketing/campaigns', [
      fixture('marketing', 'ads', 'ad_id,spend\n1,10'),
    ]);
  });

  it('queries a dataset table with NO connection doc — upload → query, no admin', async () => {
    const { status, text } = await runViaRoute('SELECT zone_name FROM public.zones ORDER BY zone_id', '/org/sales/q1');
    expect(status).toBe(200);
    expect(text).toContain('North');
    expect(text).toContain('South');
  });

  it('JOINS tables from own folder and an ANCESTOR dataset in one query', async () => {
    const { status, text } = await runViaRoute(
      `SELECT z.zone_name, SUM(d.amount) AS revenue
       FROM sales.deals d JOIN public.zones z ON d.zone_id = z.zone_id
       GROUP BY z.zone_name ORDER BY revenue DESC`,
      '/org/sales/q1',
    );
    expect(status).toBe(200);
    expect(text).toContain('North'); // 350
    expect(text).toContain('350');
    expect(text).toContain('South'); // 50
  });

  it('a SIBLING folder\'s table does not resolve — fails loudly, not silently', async () => {
    const { status, text } = await runViaRoute('SELECT * FROM marketing.ads', '/org/sales/q1');
    // The table simply does not exist in this folder's session.
    expect(status).toBeGreaterThanOrEqual(400);
    expect(text.toLowerCase()).toMatch(/ads|not exist|error/);
  });

  it('a HIDDEN table does not exist for the query surface', async () => {
    await getModules().db.exec("DELETE FROM files WHERE type = 'dataset'", []);
    await mkDataset('/org/data', [
      fixture('public', 'visible', 'a\n1'),
      fixture('public', 'secret', 'b\n2'),
    ], ['public.secret']);
    const ok = await runViaRoute('SELECT * FROM public.visible', '/org/q');
    expect(ok.status).toBe(200);
    const denied = await runViaRoute('SELECT * FROM public.secret', '/org/q');
    expect(denied.status).toBeGreaterThanOrEqual(400);
  });
});
