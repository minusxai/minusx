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

  // ONE round trip: uniqueness (single scan, COUNT vs COUNT DISTINCT — no
  // GROUP BY) UNION ALL the match-rate join, discriminated by `chk`.
  const script = (uniq: { a: number; b: number }, total: number, matched: number) => {
    mockQuery.mockImplementation(async (sql: string) => {
      expect(sql).toMatch(/UNION ALL/i);
      expect(sql).toMatch(/COUNT\(DISTINCT/i);
      expect(sql).toMatch(/LEFT JOIN/i);
      expect(sql).not.toMatch(/GROUP BY/i); // the cheap single-scan shape
      return {
        columns: ['chk', 'a', 'b'], types: [],
        rows: [
          { chk: 'uniqueness', a: uniq.a, b: uniq.b },
          { chk: 'match', a: total, b: matched },
        ],
      };
    });
  };

  it('unique target + full match → clean verification', async () => {
    script({ a: 50, b: 50 }, 1000, 1000);
    await expect(verifyRelationship(admin, REL)).resolves.toEqual({
      targetUnique: true, totalRows: 1000, matchedRows: 1000,
    });
    // BOTH checks travel in one statement (one round trip to the warehouse)
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/users/);
    expect(sql).toMatch(/orders/);
  });

  it('duplicated lookup values → targetUnique false (the fan-out warning)', async () => {
    script({ a: 52, b: 50 }, 500, 480);
    await expect(verifyRelationship(admin, REL)).resolves.toEqual({
      targetUnique: false, totalRows: 500, matchedRows: 480,
    });
  });

  it('string-typed counts (BigQuery INT64 comes back as strings) still parse', async () => {
    mockQuery.mockImplementation(async () => ({
      columns: ['chk', 'a', 'b'], types: [],
      rows: [
        { chk: 'match', a: '123', b: '99' },      // order not guaranteed —
        { chk: 'uniqueness', a: '10', b: '10' },  // rows keyed by chk
      ],
    }));
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
