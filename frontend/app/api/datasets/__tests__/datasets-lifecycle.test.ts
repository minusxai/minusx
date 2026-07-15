/**
 * Dataset lifecycle — PATCH /api/datasets/[id]: add-files, delete-table,
 * reimport (link sources). All mutations flow through FilesAPI.saveFile, so
 * role/folder permissions and the global-name gate apply unchanged.
 *
 * SECURITY: delete-table removes the S3 object whose key comes from the DOC
 * (server-trusted) — never from the client. The legacy /api/csv/delete-file
 * accepted arbitrary client keys; this endpoint must not repeat that.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { PATCH as datasetsPatch } from '@/app/api/datasets/[id]/route';
import { DocumentDB } from '@/lib/database/documents-db';
import { signStorageToken } from '@/lib/object-store/key-token';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import { LOCAL_UPLOAD_PATH } from '@/lib/config';
import { NextRequest } from 'next/server';
import type { DatasetContent, DatasetTable } from '@/lib/types/datasets';

const TEST_DB_PATH = getTestDbPath('datasets_lifecycle');
const PREFIX = `dslife-${process.pid}`;

const abs = (k: string) => join(LOCAL_UPLOAD_PATH, k);

function writeCsv(name: string, csv: string): string {
  const s3_key = `${PREFIX}/${name}`;
  mkdirSync(join(LOCAL_UPLOAD_PATH, PREFIX), { recursive: true });
  writeFileSync(abs(s3_key), csv);
  return s3_key;
}

const table = (schema: string, name: string, s3_key: string, over: Partial<DatasetTable> = {}): DatasetTable => ({
  filename: `${name}.csv`, table_name: name, schema_name: schema, s3_key,
  file_format: 'csv', row_count: 1, columns: [{ name: 'a', type: 'VARCHAR' }], source: 'upload', ...over,
});

async function mkDataset(path: string, tables: DatasetTable[]): Promise<number> {
  const name = path.split('/').pop()!;
  const id = await DocumentDB.create(name, path, 'dataset', { files: tables } as DatasetContent, []);
  await DocumentDB.update(id, name, path, { files: tables } as DatasetContent, [], `init-${id}`);
  return id;
}

async function mkFolder(path: string): Promise<void> {
  const id = await DocumentDB.create(path.split('/').pop()!, path, 'folder', { description: '' }, []);
  await DocumentDB.update(id, path.split('/').pop()!, path, { description: '' }, [], `i-${id}`);
}

async function patch(id: number, body: object) {
  const req = new NextRequest(`http://localhost:3000/api/datasets/${id}?mode=org`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-user-id': '1' },
    body: JSON.stringify(body),
  });
  const res = await datasetsPatch(req, { params: Promise.resolve({ id: String(id) }) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const content = async (id: number) => (await DocumentDB.getById(id))!.content as DatasetContent;

describe('PATCH /api/datasets/[id] lifecycle', () => {
  setupTestDb(TEST_DB_PATH);

  beforeAll(() => mkdirSync(join(LOCAL_UPLOAD_PATH, PREFIX), { recursive: true }));
  afterAll(() => rmSync(join(LOCAL_UPLOAD_PATH, PREFIX), { recursive: true, force: true }));

  let dsId: number;
  let dealsKey: string;

  beforeEach(async () => {
    await getModules().db.exec('DELETE FROM files', []);
    await mkFolder('/org');
    await mkFolder('/org/sales');
    dealsKey = writeCsv('deals.csv', 'a\n1');
    dsId = await mkDataset('/org/sales/pipeline', [table('sales', 'deals', dealsKey)]);
  });

  it('add-files: appends new tables (sniffed) — uniqueness gate still applies', async () => {
    const key = writeCsv('zones.csv', 'zone_id,zone_name\n1,North');
    const ok = await patch(dsId, { action: 'add-files', files: [{ s3_key: signStorageToken(key), filename: 'zones.csv', schema_name: 'sales' }] });
    expect(ok.status).toBe(200);
    const c = await content(dsId);
    expect(c.files.map((t) => t.table_name).sort()).toEqual(['deals', 'zones']);
    expect(c.files.find((t) => t.table_name === 'zones')!.columns.map((x) => x.name)).toEqual(['zone_id', 'zone_name']);

    // adding a table whose name is already taken fails loudly
    const key2 = writeCsv('deals2.csv', 'b\n2');
    const clash = await patch(dsId, { action: 'add-files', files: [{ s3_key: signStorageToken(key2), filename: 'deals2.csv', schema_name: 'sales', table_name: 'deals' }] });
    expect(clash.status).toBe(400);
    expect(String(clash.body.error?.message ?? clash.body.message)).toMatch(/already exists/);
  });

  it('delete-table: removes the table AND its S3 object (key from the DOC, not the client)', async () => {
    expect(existsSync(abs(dealsKey))).toBe(true);
    const res = await patch(dsId, { action: 'delete-table', table: 'sales.deals' });
    expect(res.status).toBe(200);
    expect((await content(dsId)).files).toHaveLength(0);
    expect(existsSync(abs(dealsKey))).toBe(false); // S3 object cleaned up
  });

  it('delete-table on an unknown table is a 400, and never touches storage', async () => {
    const res = await patch(dsId, { action: 'delete-table', table: 'sales.ghost' });
    expect(res.status).toBe(400);
    expect(existsSync(abs(dealsKey))).toBe(true);
  });

  it('reimport: re-snapshots a LINK group, replacing its tables and cleaning old objects', async () => {
    const oldKey = writeCsv('budget-old.csv', 'x\n1');
    const linkId = await mkDataset('/org/sales/budget', [
      table('fin', 'budget', oldKey, { source: 'link', source_url: 'https://sheet', source_group: 'sid' }),
    ]);
    const newKey = writeCsv('budget-new.csv', 'x,y\n1,2');
    const { importGoogleSheetToS3 } = await import('@/lib/csv-processor');
    (importGoogleSheetToS3 as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      files: [{ filename: 'budget.csv', s3_key: newKey, schema_name: 'fin', table_name: 'budget', file_format: 'csv' }],
      spreadsheetId: 'sid',
    });

    const res = await patch(linkId, { action: 'reimport', source_group: 'sid' });
    expect(res.status).toBe(200);
    const c = await content(linkId);
    expect(c.files).toHaveLength(1);
    // the processor re-registers (and may convert) the snapshot — new key, old gone
    expect(c.files[0].s3_key).not.toBe(oldKey);
    expect(c.files[0].columns.map((x) => x.name)).toEqual(['x', 'y']);
    expect(c.files[0].source).toBe('link');
    expect(c.files[0].source_url).toBe('https://sheet');
    expect(existsSync(abs(oldKey))).toBe(false); // stale snapshot cleaned up
  });
});

vi.mock('@/lib/csv-processor', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/csv-processor')>();
  return { ...mod, importGoogleSheetToS3: vi.fn(mod.importGoogleSheetToS3) };
});
