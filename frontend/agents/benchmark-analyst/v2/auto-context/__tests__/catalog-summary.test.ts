import { describe, it, expect } from 'vitest';
import type { ColumnMeta } from '@/lib/connections/base';
import {
  buildCatalogSummary,
  renderCatalogSummary,
} from '../catalog-summary';
import type { FlatColumn } from '../schema';

const col = (table: string, column: string, type = 'INTEGER'): FlatColumn => ({
  connection: 'db', schema: 'public', table, column, type,
});
const metaKey = (c: FlatColumn) => `${c.connection}.${c.schema}.${c.table}.${c.column}`;
const tableKey = (c: FlatColumn) => `${c.connection}.${c.schema}.${c.table}`;

describe('buildCatalogSummary', () => {
  it('groups columns by table preserving catalog order and fetches one sample per table', async () => {
    const u_id = col('users', 'id');
    const u_name = col('users', 'name', 'VARCHAR');
    const o_id = col('orders', 'id');
    const fetch = async (t: { table: string }) => [{ marker: t.table }];

    const summary = await buildCatalogSummary(
      [u_id, u_name, o_id], new Map(), new Map(), fetch,
    );
    expect(summary.tables).toHaveLength(2);
    expect(summary.tables[0].table).toBe('users');
    expect(summary.tables[0].columns.map((c) => c.name)).toEqual(['id', 'name']);
    expect(summary.tables[1].table).toBe('orders');
    expect(summary.tables[0].samples).toEqual([{ marker: 'users' }]);
    expect(summary.tables[1].samples).toEqual([{ marker: 'orders' }]);
  });

  it('attaches stats and rowCount to each column / table when available', async () => {
    const c = col('users', 'id');
    const stats = new Map<string, ColumnMeta>([
      [metaKey(c), { nDistinct: 100, nullCount: 0 }],
    ]);
    const rows = new Map<string, number>([[tableKey(c), 1000]]);
    const summary = await buildCatalogSummary([c], stats, rows, async () => []);
    expect(summary.tables[0].rowCount).toBe(1000);
    expect(summary.tables[0].columns[0].meta?.nDistinct).toBe(100);
  });
});

describe('renderCatalogSummary', () => {
  it('renders a markdown blob with one section per table + stats + samples', async () => {
    const c = col('users', 'id');
    const stats = new Map<string, ColumnMeta>([
      [metaKey(c), { nDistinct: 100, topValues: [{ value: 1, count: 50, fraction: 0.5 }] }],
    ]);
    const rows = new Map<string, number>([[tableKey(c), 1000]]);
    const summary = await buildCatalogSummary([c], stats, rows, async () => [{ id: 1 }]);
    const out = renderCatalogSummary(summary);
    expect(out).toContain('## db.public.users (1000 rows)');
    expect(out).toContain('| id | INTEGER | nDistinct=100');
    expect(out).toContain('Sample rows:');
    expect(out).toContain('"id":1');
  });

  it('omits row count when unknown', async () => {
    const c = col('users', 'id');
    const summary = await buildCatalogSummary([c], new Map(), new Map(), async () => []);
    const out = renderCatalogSummary(summary);
    expect(out).toContain('## db.public.users\n');
    expect(out).not.toMatch(/users \(\d+ rows\)/);
  });

  it('drops Sample rows everywhere when full render would exceed maxChars (compact pass)', async () => {
    // Two tables, each with a sample row containing a long value. The
    // first pass (with samples) exceeds the budget; the compact pass
    // (without samples) fits and keeps both tables visible.
    const colA = col('a', 'data', 'VARCHAR');
    const colB = col('b', 'data', 'VARCHAR');
    const sampleData = 'x'.repeat(2000);
    const sampleFn = async () => [{ data: sampleData }];
    const summary = await buildCatalogSummary([colA, colB], new Map(), new Map(), sampleFn);
    // Budget: enough for schema/stats of both tables but too small for
    // even one sample row (~2K chars).
    const out = renderCatalogSummary(summary, 400);
    expect(out).toContain('## db.public.a');
    expect(out).toContain('## db.public.b');
    expect(out).not.toContain('Sample rows:');
  });

  it('drops trailing tables when even compact pass exceeds maxChars', async () => {
    // 5 tables, budget tight enough that compact rendering of all 5
    // still overflows — trailing ones get dropped.
    const cols = Array.from({ length: 5 }, (_, i) => col(`t${i}`, 'c1', 'VARCHAR'));
    const summary = await buildCatalogSummary(cols, new Map(), new Map(), async () => []);
    const out = renderCatalogSummary(summary, 150);
    expect(out).toContain('## db.public.t0');
    // Should NOT contain t4 — budget too tight.
    expect(out).not.toContain('## db.public.t4');
  });

  it('returns the full render when everything fits within maxChars', async () => {
    const c = col('users', 'id');
    const summary = await buildCatalogSummary([c], new Map(), new Map(), async () => [{ id: 1 }]);
    const out = renderCatalogSummary(summary, 100_000);
    // Sample rows present (full pass succeeded).
    expect(out).toContain('Sample rows:');
    expect(out).toContain('"id":1');
  });
});
