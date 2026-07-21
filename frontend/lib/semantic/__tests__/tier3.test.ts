/**
 * Tier-3 dry-run save gate (Semantic_Model_v2.md §2.5, M4): every probe is the
 * compiled metric wrapped `SELECT * FROM (…) AS _probe LIMIT 0`, executed via
 * the real connector seam. Blocking policy: bad SQL blocks; infrastructure
 * failures fail open with `verified: false`; probe scope is exactly
 * three cases (metric-text-only → delta, metadata-only → nothing,
 * structural → all) with `verified: false` metrics sticky in every probe set.
 */
import { DocumentDB } from '@/lib/database/documents-db';
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

const model = (metrics: SemanticMetricV2[], overrides: Partial<SemanticModelV2> = {}): SemanticModelV2 => ({
  name: 'Orders',
  connection: 'warehouse',
  primary: { kind: 'table', schema: 'mxfood', table: 'orders' },
  dimensions: [{ name: 'Zone', source: 'primary', column: 'zone_name' }],
  measures: [{ name: 'Revenue', agg: 'SUM', column: 'total' }],
  metrics,
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

  it('probes each metric as SELECT * FROM (…) AS _probe LIMIT 0 with a GROUP BY', async () => {
    await save(contextId, model([M_A]));
    const sqls = probeSqls();
    expect(sqls).toHaveLength(1);
    expect(sqls[0]).toMatch(/SELECT \* FROM \(/);
    expect(sqls[0]).toMatch(/AS _probe LIMIT 0/);
    expect(sqls[0]).toMatch(/GROUP BY zone_name/);      // first non-m2m dimension
    expect(sqls[0]).toContain('SUM(orders.total) - 1'); // wait — no joins: unqualified
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
    mockQuery.mockRejectedValueOnce(new Error('Query timed out after 60s (server bound; tune via QUERY_SERVER_TIMEOUT_MS).'));
    await expect(save(contextId, model([M_A]))).resolves.toBeTruthy();
    const m = await savedModel(contextId);
    expect(m.metrics![0].verified).toBe(false);
  });

  it('a successful probe stamps verified: true', async () => {
    await save(contextId, model([M_A]));
    const m = await savedModel(contextId);
    expect(m.metrics![0].verified).toBe(true);
  });

  it('metric-text-only edit probes ONLY the changed metric', async () => {
    await save(contextId, model([M_A, M_B]));
    expect(probeSqls()).toHaveLength(2);
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

  it('ANY structural edit (e.g. a measure column change) probes ALL metrics', async () => {
    await save(contextId, model([M_A, M_B]));
    mockQuery.mockClear();
    await save(contextId, model(
      [{ ...M_A, verified: true }, { ...M_B, verified: true }],
      { measures: [{ name: 'Revenue', agg: 'AVG', column: 'total' }] },
    ));
    expect(probeSqls()).toHaveLength(2);
  });

  // §2.5 rename rules. Both fall out of structureOf() serializing measure /
  // dimension names + the references array while EXCLUDING metrics — an
  // innocent refactor of structureOf (e.g. dropping the `name` off measures,
  // or folding metrics back in) silently flips both scopes, so lock them.
  it('a MEASURE rename is structural: ALL metrics are probed', async () => {
    await save(contextId, model([M_A, M_B]));
    mockQuery.mockClear();
    await save(contextId, model(
      [{ ...M_A, verified: true }, { ...M_B, verified: true }],
      { measures: [{ name: 'Rev', agg: 'SUM', column: 'total' }] }, // Revenue → Rev
    ));
    // Neither metric's SQL mentions the measure, yet both re-probe: a rename
    // can break definitions that name it (ratio metrics), so scope is ALL.
    expect(probeSqls()).toHaveLength(2);
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

    const verified = new Map((await savedModel(contextId)).metrics!.map((m) => [m.name, m.verified]));
    expect(verified.get('Net 999')).toBe(false);                       // infra → fails open
    for (const n of [1, 2, 3, 4, 5]) expect(verified.get(`Net ${n}`)).toBe(true); // peers unaffected
    expect(probeSqls()).toHaveLength(6);                               // every metric probed
    expect(maxInFlight).toBeLessThanOrEqual(4);                        // PROBE_CONCURRENCY cap
    expect(maxInFlight).toBeGreaterThan(1);                            // …and not sequential
  });

  it('verified: false metrics are STICKY in every subsequent probe set until they verify', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.1:5432'));
    await save(contextId, model([M_A, M_B])); // A fails infra → verified: false; B ok
    expect((await savedModel(contextId)).metrics![0].verified).toBe(false);
    mockQuery.mockClear();
    // Metadata-only save — would probe nothing, but the sticky rule re-probes A.
    await save(contextId, model([
      { ...M_A, verified: false },
      { ...M_B, verified: true, description: 'b' },
    ]));
    const sqls = probeSqls();
    expect(sqls).toHaveLength(1);
    expect(sqls[0]).toContain('- 1'); // Net A
    expect((await savedModel(contextId)).metrics![0].verified).toBe(true); // now verified
  });
});
