/**
 * Relationship verification — the two check queries are built as QueryIR and
 * rendered per dialect (never hand-quoted); results classify the relationship
 * as a valid lookup (unique target) and report the FK match rate.
 */
import { DocumentDB } from '@/lib/database/documents-db';
import { verifyRelationship } from '@/lib/semantic/verify.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import type { ConnectionContent, TableRelationship } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('@/lib/connections', () => ({
  getNodeConnector: () => ({ query: mockQuery }),
}));

const TEST_DB_PATH = getTestDbPath('semantic_verify');

const admin: EffectiveUser = {
  userId: 1, name: 'Admin', email: 'admin@example.com', role: 'admin', mode: 'org', home_folder: '',
};

const REL: TableRelationship = {
  connection: 'warehouse', schema: 'public', table: 'orders',
  column: 'user_id', targetSchema: 'public', targetTable: 'users', targetColumn: 'id',
  relationship: 'many_to_one',
};

describe('verifyRelationship', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    mockQuery.mockReset();
    await getModules().db.exec('DELETE FROM files', []);
    const conn: ConnectionContent = { type: 'duckdb', config: { file_path: '../data/x.duckdb' } };
    const id = await DocumentDB.create('warehouse', '/org/database/warehouse', 'connection', conn, []);
    await DocumentDB.update(id, 'warehouse', '/org/database/warehouse', conn, [], 'init');
  });

  // Uniqueness is a single scan: COUNT(*) vs COUNT(DISTINCT col) — no GROUP BY.
  const script = (uniq: { c: number; d: number }, total: number, matched: number) => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (/COUNT\(DISTINCT/i.test(sql) && !/JOIN/i.test(sql)) {
        expect(sql).not.toMatch(/GROUP BY/i); // the cheap single-scan shape
        return { columns: ['c', 'd'], types: [], rows: [uniq] };
      }
      if (/LEFT JOIN/i.test(sql)) {
        return { columns: ['total', 'matched'], types: [], rows: [{ total, matched }] };
      }
      throw new Error(`unexpected verification SQL: ${sql}`);
    });
  };

  it('unique target + full match → clean verification', async () => {
    script({ c: 50, d: 50 }, 1000, 1000);
    await expect(verifyRelationship(admin, REL)).resolves.toEqual({
      targetUnique: true, totalRows: 1000, matchedRows: 1000,
    });
    // both checks ran, against the right tables
    const sqls = mockQuery.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((q) => /users/.test(q) && /COUNT\(DISTINCT/i.test(q))).toBe(true);
    expect(sqls.some((q) => /orders/.test(q) && /LEFT JOIN/i.test(q))).toBe(true);
  });

  it('duplicated lookup values → targetUnique false (the fan-out warning)', async () => {
    script({ c: 52, d: 50 }, 500, 480);
    await expect(verifyRelationship(admin, REL)).resolves.toEqual({
      targetUnique: false, totalRows: 500, matchedRows: 480,
    });
  });

  it('string-typed counts (BigQuery INT64 comes back as strings) still parse', async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      /LEFT JOIN/i.test(sql)
        ? { columns: ['total', 'matched'], types: [], rows: [{ total: '123', matched: '99' }] }
        : { columns: ['c', 'd'], types: [], rows: [{ c: '10', d: '10' }] });
    await expect(verifyRelationship(admin, REL)).resolves.toEqual({
      targetUnique: true, totalRows: 123, matchedRows: 99,
    });
  });

  it('rejects incomplete relationships and self-joins without running queries', async () => {
    await expect(verifyRelationship(admin, { ...REL, column: '' })).rejects.toThrow();
    await expect(verifyRelationship(admin, { ...REL, targetTable: 'orders', targetColumn: 'id' })).rejects.toThrow(/self-join/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
