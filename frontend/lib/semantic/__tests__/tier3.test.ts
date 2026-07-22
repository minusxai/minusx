/**
 * Tier-3 dry-run save gate (Semantic_Model_v2.md §2.5, M4): every probe is the
 * compiled metric wrapped `SELECT * FROM (…) AS _probe LIMIT 0`, executed via
 * the real connector seam. Blocking policy: bad SQL blocks; infrastructure
 * failures fail open with `verified: false`. Probe scope: metadata-only →
 * nothing; a changed/added metric → itself (an aggregation metric's definition
 * is EMBEDDED in the essence of every ratio built on it, so changing one
 * re-probes its dependent ratios too); anything structural outside the metric
 * list (dimensions, references, primary) → all; `verified: false` metrics are
 * sticky in every probe set.
 */
import { DocumentDB } from '@/lib/database/documents-db';
import { testSemanticModel } from '@/lib/semantic/save-gate.server';
import { FilesAPI } from '@/lib/data/files.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import type { ConnectionContent, ContextContent, ContextVersion, SemanticModelV2, SemanticMetricV2 } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
const SCHEMA = {
  updated_at: new Date().toISOString(),
  schemas: [{ schema: 'mxfood', tables: [
    { table: 'orders', columns: [{ name: 'zone_name', type: 'VARCHAR' }, { name: 'total', type: 'DOUBLE' }] },
  ]}],
};
vi.mock('@/lib/connections', () => ({
  getNodeConnector: () => ({ query: mockQuery, getSchema: async () => SCHEMA.schemas }),
}));
vi.mock('@/lib/connections/statistics-engine', () => ({
  profileDatabase: vi.fn(async (_t: string, s: unknown) => ({ schema: s, queryCount: 0 })),
}));

const TEST_DB_PATH = getTestDbPath('semantic_tier3');
const admin: EffectiveUser = { userId: 1, name: 'A', email: 'a@e.com', role: 'admin', mode: 'org', home_folder: '' };

const model = (
  metrics: SemanticMetricV2[],
  overrides: Partial<SemanticModelV2> = {},
  aggregations: SemanticMetricV2[] = [{ name: 'Revenue', type: 'aggregation', agg: 'SUM', column: 'total' }],
): SemanticModelV2 => ({
  name: 'Orders',
  connection: 'warehouse',
  primary: { kind: 'table', schema: 'mxfood', table: 'orders' },
  dimensions: [{ name: 'Zone', source: 'primary', column: 'zone_name' }],
  metrics: [...aggregations, ...metrics],
  ...overrides,
});

const M_A: SemanticMetricV2 = { name: 'Net A', type: 'sql', sql: 'SUM(primary.total) - 1' };
const M_B: SemanticMetricV2 = { name: 'Net B', type: 'sql', sql: 'SUM(primary.total) - 2' };

const content = (m: SemanticModelV2): ContextContent => ({
  versions: [{
    version: 1, whitelist: [{ name: 'warehouse', type: 'connection' }], docs: [], semanticModels: [m],
    createdAt: new Date().toISOString(), createdBy: 1,
  } as ContextVersion],
  published: { all: 1 },
} as ContextContent);

async function mkPublished(name: string, path: string, type: string, c: object): Promise<number> {
  const id = await DocumentDB.create(name, path, type, c, []);
  await DocumentDB.update(id, name, path, c, [], `init-${id}`);
  return id;
}

const save = (contextId: number, m: SemanticModelV2) =>
  FilesAPI.saveFile(contextId, 'context', '/org/context', content(m) as never, [], admin);

const savedModel = async (contextId: number): Promise<SemanticModelV2> => {
  const row = await DocumentDB.getById(contextId);
  return (row!.content as ContextContent).versions![0].semanticModels![0];
};

const savedMetric = async (contextId: number, name: string): Promise<SemanticMetricV2> =>
  (await savedModel(contextId)).metrics.find((m) => m.name === name)!;

const probeSqls = (): string[] => mockQuery.mock.calls.map((c) => c[0] as string);

describe('tier-3 dry-run save gate', () => {
  setupTestDb(TEST_DB_PATH);
  let contextId: number;

  beforeEach(async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ columns: ['_probe_dim', 'm'], types: ['VARCHAR', 'DOUBLE'], rows: [] });
    await getModules().db.exec('DELETE FROM files', []);
    const conn: ConnectionContent = { type: 'duckdb', config: { file_path: '../x.duckdb' }, schema: SCHEMA };
    await mkPublished('warehouse', '/org/database/warehouse', 'connection', conn);
    contextId = await mkPublished('context', '/org/context', 'context',
      { versions: [{ version: 1, whitelist: [{ name: 'warehouse', type: 'connection' }], docs: [], createdAt: new Date().toISOString(), createdBy: 1 }], published: { all: 1 } });
  });

  it('probes EVERY metric of a new model as SELECT * FROM (…) AS _probe LIMIT 0 with a GROUP BY', async () => {
    await save(contextId, model([M_A]));
    const sqls = probeSqls();
    expect(sqls).toHaveLength(2); // the Revenue aggregation metric AND Net A
    for (const sql of sqls) {
      expect(sql).toMatch(/SELECT \* FROM \(/);
      expect(sql).toMatch(/AS _probe LIMIT 0/);
      expect(sql).toMatch(/GROUP BY zone_name/);        // first non-m2m dimension
    }
    expect(sqls.some((q) => q.includes('SUM(orders.total) - 1'))).toBe(true); // primary. → base name
  });

  it('zero-dimension model: probe groups by the first exposed primary column', async () => {
    await save(contextId, model([M_A], { dimensions: [] }));
    const sqls = probeSqls();
    expect(sqls[0]).toMatch(/GROUP BY zone_name/); // first exposed column of mxfood.orders
  });

  it('a bad-SQL metric BLOCKS the save with the engine error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Binder Error: column "nope" does not exist'));
    await expect(save(contextId, model([M_A]))).rejects.toThrow(/Binder Error/);
  });

  it('an infrastructure failure fails OPEN: save succeeds, metric stamped verified: false', async () => {
    // Target Net A's probe by its SQL — probe order across workers isn't fixed.
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('- 1')) throw new Error('Query timed out after 60s (server bound; tune via QUERY_SERVER_TIMEOUT_MS).');
      return { columns: ['_probe_dim', 'm'], types: ['VARCHAR', 'DOUBLE'], rows: [] };
    });
    await expect(save(contextId, model([M_A]))).resolves.toBeTruthy();
    expect((await savedMetric(contextId, 'Net A')).verified).toBe(false);
    expect((await savedMetric(contextId, 'Revenue')).verified).toBe(true);
  });

  it('a successful probe stamps verified: true', async () => {
    await save(contextId, model([M_A]));
    expect((await savedMetric(contextId, 'Net A')).verified).toBe(true);
  });

  it('metric-text-only edit probes ONLY the changed metric', async () => {
    await save(contextId, model([M_A, M_B]));
    expect(probeSqls()).toHaveLength(3); // Revenue + Net A + Net B (new model)
    mockQuery.mockClear();
    const edited: SemanticMetricV2 = { ...M_B, sql: 'SUM(primary.total) - 20' };
    await save(contextId, model([{ ...M_A, verified: true }, edited]));
    const sqls = probeSqls();
    expect(sqls).toHaveLength(1);
    expect(sqls[0]).toContain('- 20');
  });

  it('a PURE metric deletion probes nothing', async () => {
    await save(contextId, model([M_A, M_B]));
    mockQuery.mockClear();
    await save(contextId, model([{ ...M_A, verified: true }]));
    expect(probeSqls()).toHaveLength(0);
  });

  it('metadata-only edits (descriptions/labels) probe nothing', async () => {
    await save(contextId, model([M_A]));
    mockQuery.mockClear();
    await save(contextId, model(
      [{ ...M_A, verified: true, description: 'net of one' }],
      { description: 'the orders model' },
    ));
    expect(probeSqls()).toHaveLength(0);
  });

  it('an aggregation-metric change probes ITSELF + dependent ratios — not unrelated metrics', async () => {
    const AGGS: SemanticMetricV2[] = [
      { name: 'Revenue', type: 'aggregation', agg: 'SUM', column: 'total' },
      { name: 'Cnt', type: 'aggregation', agg: 'COUNT' },
    ];
    const RATIO: SemanticMetricV2 = { name: 'AOV', type: 'ratio', numerator: 'Revenue', denominator: 'Cnt' };
    await save(contextId, model([RATIO, M_A], {}, AGGS));
    mockQuery.mockClear();
    // Revenue's definition changes: SUM → AVG. The ratio EMBEDS Revenue's
    // resolved definition in its essence, so it re-probes; Cnt and the
    // unrelated SQL metric do not.
    await save(contextId, model(
      [{ ...RATIO, verified: true }, { ...M_A, verified: true }],
      {},
      [{ name: 'Revenue', type: 'aggregation', agg: 'AVG', column: 'total' }, AGGS[1]],
    ));
    const sqls = probeSqls();
    expect(sqls).toHaveLength(2);
    expect(sqls.some((q) => q.includes('AVG(total)') && !q.includes('NULLIF'))).toBe(true); // Revenue itself
    expect(sqls.some((q) => q.includes('NULLIF'))).toBe(true);                              // the ratio
    expect(sqls.some((q) => q.includes('- 1'))).toBe(false);                                // Net A untouched
  });

  it('an aggregation-metric RENAME probes it under the new name only', async () => {
    await save(contextId, model([M_A, M_B]));
    mockQuery.mockClear();
    await save(contextId, model(
      [{ ...M_A, verified: true }, { ...M_B, verified: true }],
      {},
      [{ name: 'Rev', type: 'aggregation', agg: 'SUM', column: 'total' }], // Revenue → Rev
    ));
    // A rename is an add (new name) + pure deletion (old): one probe. A ratio
    // naming the OLD name would fail tier-1 ("not a declared aggregation
    // metric") before any probe ran, so nothing else needs re-checking.
    const sqls = probeSqls();
    expect(sqls).toHaveLength(1);
    expect(sqls[0]).toContain('AS rev');
  });

  it('a TRUE structural edit (dimension change) probes ALL metrics', async () => {
    await save(contextId, model([M_A, M_B]));
    mockQuery.mockClear();
    await save(contextId, model(
      [{ ...M_A, verified: true }, { ...M_B, verified: true }],
      { dimensions: [{ name: 'Zone Renamed', source: 'primary', column: 'zone_name' }] },
    ));
    expect(probeSqls()).toHaveLength(3); // Revenue + Net A + Net B
  });

  it('a METRIC rename stays case (1): only the renamed metric is probed', async () => {
    await save(contextId, model([M_A, M_B]));
    mockQuery.mockClear();
    await save(contextId, model([
      { ...M_A, verified: true },
      { ...M_B, name: 'Net B2', verified: true }, // rename only — SQL untouched
    ]));
    const sqls = probeSqls();
    expect(sqls).toHaveLength(1);          // NOT structural, and the old name's
    expect(sqls[0]).toContain('- 2');      // disappearance is a pure deletion
    expect(sqls[0]).toContain('net_b2');   // probed under the NEW name
  });

  // §2.5 probe execution policy: parallel, capped at 4, per-probe error
  // classification — "one slow metric never aborts the rest".
  it('probes are isolated + capped: one infra failure leaves its peers verified and the save SUCCEEDS', async () => {
    const metrics: SemanticMetricV2[] = [1, 2, 3, 4, 5, 999].map((n) => ({
      name: `Net ${n}`, type: 'sql', sql: `SUM(primary.total) - ${n}`,
    }));
    let inFlight = 0;
    let maxInFlight = 0;
    mockQuery.mockImplementation(async (sql: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 20)); // force real overlap
        if (sql.includes('- 999')) {
          throw new Error('Query timed out after 60s (server bound; tune via QUERY_SERVER_TIMEOUT_MS).');
        }
        return { columns: ['_probe_dim', 'm'], types: ['VARCHAR', 'DOUBLE'], rows: [] };
      } finally {
        inFlight -= 1;
      }
    });

    await expect(save(contextId, model(metrics))).resolves.toBeTruthy();

    const verified = new Map((await savedModel(contextId)).metrics.map((m) => [m.name, m.verified]));
    expect(verified.get('Net 999')).toBe(false);                       // infra → fails open
    for (const n of [1, 2, 3, 4, 5]) expect(verified.get(`Net ${n}`)).toBe(true); // peers unaffected
    expect(verified.get('Revenue')).toBe(true);
    expect(probeSqls()).toHaveLength(7);                               // every metric probed (incl. Revenue)
    expect(maxInFlight).toBeLessThanOrEqual(4);                        // PROBE_CONCURRENCY cap
    expect(maxInFlight).toBeGreaterThan(1);                            // …and not sequential
  });

  it('verified: false metrics are STICKY in every subsequent probe set until they verify', async () => {
    // Target Net A's probe by its SQL — probe order across workers isn't fixed.
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('- 1')) throw new Error('connect ECONNREFUSED 10.0.0.1:5432');
      return { columns: ['_probe_dim', 'm'], types: ['VARCHAR', 'DOUBLE'], rows: [] };
    });
    await save(contextId, model([M_A, M_B])); // A fails infra → verified: false; B ok
    expect((await savedMetric(contextId, 'Net A')).verified).toBe(false);
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ columns: ['_probe_dim', 'm'], types: ['VARCHAR', 'DOUBLE'], rows: [] });
    // Metadata-only save — would probe nothing, but the sticky rule re-probes A.
    await save(contextId, model([
      { ...M_A, verified: false },
      { ...M_B, verified: true, description: 'b' },
    ]));
    const sqls = probeSqls();
    expect(sqls).toHaveLength(1);
    expect(sqls[0]).toContain('- 1'); // Net A
    expect((await savedMetric(contextId, 'Net A')).verified).toBe(true); // now verified
  });
});

// ---------------------------------------------------------------------------
// The editor's Test button — tiers 1–3 for ONE staged model, NO save.
// ---------------------------------------------------------------------------

describe('testSemanticModel (Test button)', () => {
  setupTestDb(TEST_DB_PATH);
  let contextId: number;

  beforeEach(async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ columns: ['_probe_dim', 'm'], types: ['VARCHAR', 'DOUBLE'], rows: [] });
    await getModules().db.exec('DELETE FROM files', []);
    const conn: ConnectionContent = { type: 'duckdb', config: { file_path: '../x.duckdb' }, schema: SCHEMA };
    await mkPublished('warehouse', '/org/database/warehouse', 'connection', conn);
    contextId = await mkPublished('context', '/org/context', 'context', content(model([M_A])));
  });

  it('a broken staged metric returns the engine issue WITHOUT saving anything', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('- 99')) throw new Error('Parser Error: syntax error at or near "AS"');
      return { columns: ['_probe_dim', 'm'], types: ['VARCHAR', 'DOUBLE'], rows: [] };
    });
    const staged = model([{ name: 'Broken', type: 'sql', sql: 'SUM(primary.total) - 99' }]);
    const stored = (await DocumentDB.getById(contextId))!.content as ContextContent;
    const result = await testSemanticModel(staged, stored, '/org/context', admin);
    expect(result.issues.some((i) => i.includes('Parser Error'))).toBe(true);
    // the stored context is untouched — Test never writes
    const after = (await DocumentDB.getById(contextId))!.content as ContextContent;
    expect(after.versions![0].semanticModels![0].metrics.some((m) => m.name === 'Broken')).toBe(false);
  });

  it('a valid staged model returns an empty issue list and a per-metric verified map', async () => {
    const staged = model([M_A, M_B]);
    const stored = (await DocumentDB.getById(contextId))!.content as ContextContent;
    const result = await testSemanticModel(staged, stored, '/org/context', admin);
    expect(result.issues).toEqual([]);
    expect(result.verified).toEqual({ Revenue: true, 'Net A': true, 'Net B': true });
  });

  it('tier-1 problems come back prefixed, without any probe running', async () => {
    const staged = model([{ name: 'Bad', type: 'sql', sql: 'SUM(nope)' }]);
    const stored = (await DocumentDB.getById(contextId))!.content as ContextContent;
    const result = await testSemanticModel(staged, stored, '/org/context', admin);
    expect(result.issues.some((i) => i.startsWith('Semantic model "Orders": '))).toBe(true);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
