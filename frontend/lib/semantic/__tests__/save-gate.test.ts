/**
 * Tier-1 save gate for authored semantic models (Semantic_Model_v2.md M1).
 *
 * Every context write passes through FilesAPI.saveFile → the semantic gate, so
 * an invalid model blocks the version save regardless of author (UI, raw JSON,
 * agent EditFile). Mirrors the views gate (stampAndValidateViews).
 */
import { DocumentDB } from '@/lib/database/documents-db';
import { FilesAPI } from '@/lib/data/files.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import type { ConnectionContent, ContextContent, ContextVersion, SemanticModelV2, ViewDef } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const SCHEMA = {
  updated_at: new Date().toISOString(),
  schemas: [{ schema: 'mxfood', tables: [
    { table: 'orders', columns: [{ name: 'zone_name', type: 'VARCHAR' }, { name: 'total', type: 'DOUBLE' }] },
  ]}],
};
vi.mock('@/lib/connections', () => ({
  getNodeConnector: () => ({
    // Tier-3 probes flow through this connector; resolve them (tier-3's own
    // behaviors are covered in tier3.test.ts — this file tests tiers 1–2).
    query: vi.fn().mockResolvedValue({ columns: ['_probe_dim', 'm'], types: ['VARCHAR', 'DOUBLE'], rows: [] }),
    getSchema: async () => SCHEMA.schemas,
  }),
}));
vi.mock('@/lib/connections/statistics-engine', () => ({
  profileDatabase: vi.fn(async (_t: string, s: unknown) => ({ schema: s, queryCount: 0 })),
}));

const TEST_DB_PATH = getTestDbPath('semantic_save_gate');
const admin: EffectiveUser = { userId: 1, name: 'A', email: 'a@e.com', role: 'admin', mode: 'org', home_folder: '' };

const model = (overrides: Partial<SemanticModelV2> = {}): SemanticModelV2 => ({
  name: 'Orders',
  connection: 'warehouse',
  primary: { kind: 'table', schema: 'mxfood', table: 'orders' },
  dimensions: [{ name: 'Zone', source: 'primary', column: 'zone_name' }],
  ...overrides,
  // The Revenue aggregation metric is always present; override metrics append after it.
  metrics: [
    { name: 'Revenue', type: 'aggregation', agg: 'SUM', column: 'total' },
    ...(overrides.metrics ?? []),
  ],
});

const version = (semanticModels: SemanticModelV2[], views: ViewDef[] = []): ContextVersion => ({
  version: 1, whitelist: [{ name: 'warehouse', type: 'connection' }], docs: [], views, semanticModels,
  createdAt: new Date().toISOString(), createdBy: 1,
});

const content = (semanticModels: SemanticModelV2[], views: ViewDef[] = []): ContextContent =>
  ({ versions: [version(semanticModels, views)], published: { all: 1 } } as ContextContent);

async function mkPublished(name: string, path: string, type: string, c: object): Promise<number> {
  const id = await DocumentDB.create(name, path, type, c, []);
  await DocumentDB.update(id, name, path, c, [], `init-${id}`);
  return id;
}

describe('semantic model save gate (tier 1)', () => {
  setupTestDb(TEST_DB_PATH);
  let contextId: number;

  beforeEach(async () => {
    await getModules().db.exec('DELETE FROM files', []);
    const conn: ConnectionContent = { type: 'duckdb', config: { file_path: '../x.duckdb' }, schema: SCHEMA };
    await mkPublished('warehouse', '/org/database/warehouse', 'connection', conn);
    contextId = await mkPublished('context', '/org/context', 'context', content([]));
  });

  it('accepts a valid model', async () => {
    await expect(
      FilesAPI.saveFile(contextId, 'context', '/org/context', content([model()]) as never, [], admin),
    ).resolves.toBeTruthy();
  });

  it('blocks the save when a model references an unexposed column', async () => {
    const bad = model({ dimensions: [{ name: 'Zone', source: 'primary', column: 'nope_col' }] });
    await expect(
      FilesAPI.saveFile(contextId, 'context', '/org/context', content([bad]) as never, [], admin),
    ).rejects.toThrow(/nope_col/);
  });

  it('blocks the save when a metric SQL ref is invalid', async () => {
    const bad = model({ metrics: [{ name: 'M', type: 'sql', sql: 'SUM(ghost.amount)' }] });
    await expect(
      FilesAPI.saveFile(contextId, 'context', '/org/context', content([bad]) as never, [], admin),
    ).rejects.toThrow(/ghost/);
  });

  it('blocks a semantic model named like a view in the same version', async () => {
    const v: ViewDef = { name: 'orders_model', connection: 'warehouse', sql: 'SELECT 1 AS x' };
    await expect(
      FilesAPI.saveFile(contextId, 'context', '/org/context',
        content([model({ name: 'orders_model' })], [v]) as never, [], admin),
    ).rejects.toThrow(/share one namespace/i);
  });

  it('tier 2: compile-probes every metric on save (an uncompilable metric blocks)', async () => {
    // A ratio metric that survives a hypothetical weaker tier-1 but must be
    // compile-probed: numerator names a SQL metric (not an aggregation metric)
    // — tier-1 catches this too, but the assertion locks that the save path
    // reports it.
    const bad = model({
      metrics: [
        { name: 'Half Revenue', type: 'sql', sql: 'SUM(primary.total) / 2' },
        { name: 'Broken', type: 'ratio', numerator: 'Half Revenue', denominator: 'Revenue' },
      ],
    });
    await expect(
      FilesAPI.saveFile(contextId, 'context', '/org/context', content([bad]) as never, [], admin),
    ).rejects.toThrow(/Half Revenue|measure/);
  });

  it('tier 2: a model whose ONLY dimensions are m2m still saves (probe must not pick an m2m dimension)', async () => {
    // m2m compilation is deferred — the tier-2 probe must skip m2m-sourced
    // dimensions or a perfectly valid model becomes unsaveable.
    const m2mOnly = model({
      primaryKey: ['zone_name'],
      references: [{
        source: { kind: 'table', schema: 'mxfood', table: 'orders' },
        alias: 'tagged',
        relationship: 'many_to_many',
        through: {
          source: { kind: 'table', schema: 'mxfood', table: 'orders' },
          primaryOn: [{ primaryColumn: 'zone_name', bridgeColumn: 'zone_name' }],
          referencedOn: [{ bridgeColumn: 'zone_name', referencedColumn: 'zone_name' }],
        },
      }],
      dimensions: [{ name: 'Tagged Zone', source: 'tagged', column: 'zone_name' }],
      metrics: [{ name: 'Total Revenue', type: 'sql', sql: 'SUM(primary.total)' }],
    });
    await expect(
      FilesAPI.saveFile(contextId, 'context', '/org/context', content([m2mOnly]) as never, [], admin),
    ).resolves.toBeTruthy();
  });

  it('reverse direction: blocks saving a VIEW named like an existing semantic model', async () => {
    // Model exists in the saved content; adding a clashing view must fail too.
    const v: ViewDef = { name: 'Orders', connection: 'warehouse', sql: 'SELECT 1 AS x' };
    await expect(
      FilesAPI.saveFile(contextId, 'context', '/org/context', content([model()], [v]) as never, [], admin),
    ).rejects.toThrow(/share one namespace/i);
  });
});
