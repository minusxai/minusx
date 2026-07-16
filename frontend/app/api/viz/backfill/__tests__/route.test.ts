/**
 * POST /api/viz/backfill — the non-destructive Viz V2 migration (Data Management).
 * For every question that still lacks a `viz` envelope, it executes the question's
 * query (through the shared query cache), converts `vizSettings` with the REAL
 * result columns (so temporal axes survive), and writes the envelope ALONGSIDE
 * the untouched vizSettings. Idempotent: envelope-bearing files are skipped;
 * flipping the workspace back to V1 still works because vizSettings remains.
 */
vi.mock('@/lib/auth/auth-helpers', () => ({
  getEffectiveUser: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/viz/backfill/route';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { FilesAPI } from '@/lib/data/files.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { QuestionContent } from '@/lib/types';
import { DuckDBInstance } from '@duckdb/node-api';
import os from 'os';
import path from 'path';
import fs from 'fs';

// A real (empty) duckdb file — VALUES queries need no tables, but the connector
// opens read-only, so the file must exist.
const DUCK_PATH = path.join(os.tmpdir(), 'viz-backfill-test.duckdb');

const TEST_DB_PATH = getTestDbPath('viz_backfill');

const ADMIN: EffectiveUser = {
  userId: 1,
  email: 'test@example.com',
  name: 'Test',
  role: 'admin',
  home_folder: '/org',
  mode: 'org',
};

const VIEWER: EffectiveUser = { ...ADMIN, role: 'viewer' };

const LEGACY_BAR: QuestionContent = {
  description: '',
  query: "SELECT * FROM (VALUES ('Jan', 10), ('Feb', 25)) AS t(month, revenue)",
  vizSettings: { type: 'bar', xCols: ['month'], yCols: ['revenue'] },
  parameters: [],
  connection_name: 'default_db',
  references: [],
} as unknown as QuestionContent;

const ALREADY_V2: QuestionContent = {
  ...LEGACY_BAR,
  vizSettings: { type: 'table' },
  viz: { version: 2, source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: null } },
} as unknown as QuestionContent;

const mockUser = (u: EffectiveUser) =>
  (getEffectiveUser as unknown as { mockResolvedValue: (v: EffectiveUser) => void }).mockResolvedValue(u);

const post = () => POST(new NextRequest('http://localhost/api/viz/backfill', { method: 'POST' }));

describe('POST /api/viz/backfill', () => {
  setupTestDb(TEST_DB_PATH, { withTestConnection: true });

  beforeAll(async () => {
    if (!fs.existsSync(DUCK_PATH)) {
      const instance = await DuckDBInstance.create(DUCK_PATH);
      const conn = await instance.connect();
      conn.closeSync();
    }
  });

  beforeEach(async () => {
    mockUser(ADMIN);
    // Query execution resolves connections by PATH (`/org/database/<name>`).
    await FilesAPI.createFile({
      name: 'default_db',
      path: '/org/database/default_db',
      type: 'connection',
      content: { name: 'default_db', type: 'duckdb', config: { file_path: DUCK_PATH } } as never,
      options: { returnExisting: true, createPath: true },
    }, ADMIN);
  });

  it('adds envelopes to legacy questions, skips V2 ones, never touches vizSettings', async () => {
    // createFile makes DRAFTS (invisible to listings); saveFile publishes.
    const legacy = await FilesAPI.createFile({ name: 'Legacy Bar', path: '/org/legacy-bar', type: 'question', content: LEGACY_BAR }, ADMIN);
    await FilesAPI.saveFile(legacy.data.id, 'Legacy Bar', '/org/legacy-bar', LEGACY_BAR, [], ADMIN);
    const v2 = await FilesAPI.createFile({ name: 'Already V2', path: '/org/already-v2', type: 'question', content: ALREADY_V2 }, ADMIN);
    await FilesAPI.saveFile(v2.data.id, 'Already V2', '/org/already-v2', ALREADY_V2, [], ADMIN);

    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.upgraded).toBe(1);
    expect(body.data.alreadyV2).toBe(1);

    const { data } = await FilesAPI.loadFiles([legacy.data.id, v2.data.id], ADMIN);
    const upgraded = data.find(f => f.id === legacy.data.id)!.content as QuestionContent;
    // The envelope was written from the REAL result columns…
    expect(upgraded.viz).toBeTruthy();
    const source = upgraded.viz!.source as unknown as { kind: string; spec: { encoding: Record<string, { field: string }> } };
    expect(source.kind).toBe('vega-lite');
    expect(source.spec.encoding.x.field).toBe('month');
    // …and vizSettings is byte-identical (the V1 rollback path).
    expect(upgraded.vizSettings).toEqual(LEGACY_BAR.vizSettings);

    const untouched = data.find(f => f.id === v2.data.id)!.content as QuestionContent;
    expect(untouched.viz).toEqual(ALREADY_V2.viz);
  });

  it('is idempotent — a second run upgrades nothing', async () => {
    const f = await FilesAPI.createFile({ name: 'Legacy Line', path: '/org/legacy-line', type: 'question', content: LEGACY_BAR }, ADMIN);
    await FilesAPI.saveFile(f.data.id, 'Legacy Line', '/org/legacy-line', LEGACY_BAR, [], ADMIN);
    await post();
    const res = await post();
    const body = await res.json();
    expect(body.data.upgraded).toBe(0);
    expect(body.data.alreadyV2).toBeGreaterThanOrEqual(1);
  });

  it('rejects non-admins', async () => {
    mockUser(VIEWER);
    const res = await post();
    expect(res.status).toBe(403);
  });
});
