/**
 * POST /api/datasets — the upload seam, end to end with the REAL processor
 * (column sniffing via DuckDB over local fixtures) and the REAL FilesAPI gates:
 * a signed s3 token + a folder = a live, queryable dataset in one call.
 * Forged tokens and taken table names fail as user errors (400), not 500s.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { POST as datasetsPost } from '@/app/api/datasets/route';
import { DocumentDB } from '@/lib/database/documents-db';
import { signStorageToken } from '@/lib/object-store/key-token';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import { LOCAL_UPLOAD_PATH } from '@/lib/config';
import { NextRequest } from 'next/server';

const TEST_DB_PATH = getTestDbPath('datasets_route');
const PREFIX = `dsroute-${process.pid}`;

function uploadFixture(name: string, csv: string): { s3_key: string; filename: string } {
  const s3_key = `${PREFIX}/${name}`;
  mkdirSync(join(LOCAL_UPLOAD_PATH, PREFIX), { recursive: true });
  writeFileSync(join(LOCAL_UPLOAD_PATH, s3_key), csv);
  return { s3_key: signStorageToken(s3_key), filename: name };
}

async function post(body: object) {
  const req = new NextRequest('http://localhost:3000/api/datasets?mode=org', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': '1' },
    body: JSON.stringify(body),
  });
  const res = await datasetsPost(req);
  return { status: res.status, body: await res.json() };
}

async function mkFolder(path: string): Promise<void> {
  const id = await DocumentDB.create(path.split('/').pop()!, path, 'folder', { description: '' }, []);
  await DocumentDB.update(id, path.split('/').pop()!, path, { description: '' }, [], `init-${id}`);
}

describe('POST /api/datasets (real processor + real gates)', () => {
  setupTestDb(TEST_DB_PATH);

  beforeAll(() => mkdirSync(join(LOCAL_UPLOAD_PATH, PREFIX), { recursive: true }));
  afterAll(() => rmSync(join(LOCAL_UPLOAD_PATH, PREFIX), { recursive: true, force: true }));

  beforeEach(async () => {
    await getModules().db.exec('DELETE FROM files', []);
    await mkFolder('/org');
    await mkFolder('/org/sales');
  });

  it('creates a LIVE dataset from an uploaded CSV — sniffed columns included', async () => {
    const { status, body } = await post({
      path: '/org/sales', name: 'pipeline', schema_name: 'sales',
      files: [{ ...uploadFixture('deals.csv', 'deal_id,amount\n1,100\n2,50'), schema_name: 'sales' }],
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.tables).toHaveLength(1);
    expect(body.data.tables[0].table_name).toBe('deals');
    expect(body.data.tables[0].schema_name).toBe('sales');
    expect(body.data.tables[0].columns.map((c: { name: string }) => c.name)).toEqual(['deal_id', 'amount']);
    // live immediately — visible to the (draft-excluding) listing
    const docs = await DocumentDB.listAll('dataset', ['/org']);
    expect(docs).toHaveLength(1);
  });

  it('a TAKEN table name is a 400 with the choose-another-name message', async () => {
    const first = await post({
      path: '/org/sales', name: 'a',
      files: [{ ...uploadFixture('data1.csv', 'x\n1'), schema_name: 'public', table_name: 'data' }],
    });
    expect(first.status).toBe(200);
    const clash = await post({
      path: '/org/sales', name: 'b',
      files: [{ ...uploadFixture('data2.csv', 'y\n2'), schema_name: 'public', table_name: 'data' }],
    });
    expect(clash.status).toBe(400);
    expect(String(clash.body.error?.message ?? clash.body.message)).toMatch(/already exists/);
  });

  it('a FORGED s3 token is rejected', async () => {
    const { status } = await post({
      path: '/org/sales', name: 'forged',
      files: [{ s3_key: 'not-a-real.token', filename: 'x.csv' }],
    });
    expect(status).toBe(400);
  });
});
