/**
 * Context inheritance edge cases.
 *
 * These tests pin the parts of whitelist/doc/view/model inheritance that only
 * break under specific tree SHAPES or specific combinations of the two
 * inheritance halves (`childPaths` on the parent's side, the child's whitelist
 * on the other). The headline case is sibling directories whose paths have the
 * SAME string length (e.g. /org/ALFA vs /org/BETA) — the shape a folder move
 * into a folder creates for the first time.
 *
 * Run: npm test -- context-inheritance-edge.test.ts
 */

import { DocumentDB } from '@/lib/database/documents-db';
import { FilesAPI } from '@/lib/data/files.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import type {
  ConnectionContent,
  ContextContent,
  ContextVersion,
  DatabaseSchema,
  ViewDef
} from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

// Inject schema via a fake Node.js connector keyed by connection name (same
// seam as context-loader.test.ts).
const { mockGetSchema } = vi.hoisted(() => ({ mockGetSchema: vi.fn() }));

vi.mock('@/lib/connections', () => ({
  getNodeConnector: (name: string) => ({
    getSchema: async () => (await mockGetSchema(name))?.schemas ?? [],
    query: vi.fn().mockResolvedValue({ columns: [], types: [], rows: [] }),
  }),
}));

vi.mock('@/lib/connections/statistics-engine', () => ({
  profileDatabase: vi.fn(async (_t: string, schemas: unknown) => ({ schema: schemas, queryCount: 0 })),
}));

const TEST_DB_PATH = getTestDbPath('context_inheritance_edge');

const user: EffectiveUser = {
  userId: 1,
  name: 'Admin',
  email: 'admin@example.com',
  role: 'admin',
  mode: 'org',
  home_folder: ''
};

async function mkConnection(name: string): Promise<number> {
  const content: ConnectionContent = { type: 'duckdb', config: {}, description: name };
  const id = await DocumentDB.create(name, `/org/database/${name}`, 'connection', content, []);
  await DocumentDB.update(id, name, `/org/database/${name}`, content, [], `init-${name}`);
  return id;
}

async function mkContext(path: string, version: Partial<ContextVersion>, extra?: Partial<ContextContent>): Promise<number> {
  const content: ContextContent = {
    versions: [{
      version: 1,
      whitelist: '*',
      docs: [],
      createdAt: new Date().toISOString(),
      createdBy: 1,
      ...version
    } as ContextVersion],
    published: { all: 1 },
    ...extra
  } as ContextContent;
  const id = await DocumentDB.create('context', path, 'context', content, []);
  await DocumentDB.update(id, 'context', path, content, [], `init-${path}`);
  return id;
}

async function loadContent(id: number): Promise<ContextContent> {
  const { data } = await FilesAPI.loadFiles([id], user);
  return data[0].content as ContextContent;
}

const schemaNames = (c: ContextContent, conn: string): string[] =>
  (c.fullSchema ?? []).find(d => d.databaseName === conn)?.schemas.map(s => s.schema) ?? [];

const viewNames = (c: ContextContent): string[] => (c.fullViews ?? []).map(v => v.name);

const mkView = (name: string, table: { schema: string; table: string }, childPaths?: string[]): ViewDef => ({
  name,
  connection: 'static',
  sql: `SELECT id FROM ${table.schema}.${table.table}`,
  reads: { tables: [table], views: [] },
  columns: [{ name: 'id', type: 'INTEGER' }],
  ...(childPaths ? { childPaths } : {})
});

const mkModel = (name: string, childPaths?: string[]) => ({
  name,
  connection: 'static',
  primary: { kind: 'table' as const, schema: 's1', table: 't1' },
  dimensions: [],
  metrics: [],
  ...(childPaths ? { childPaths } : {})
});

describe('Context inheritance edge cases', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    mockGetSchema.mockClear();
    await getModules().db.exec('DELETE FROM files', []);

    mockGetSchema.mockImplementation((name: string) => {
      if (name === 'main_wh') {
        return Promise.resolve({
          schemas: [{
            schema: 'core_data',
            tables: [{ table: 'pnl', columns: [{ name: 'id', type: 'INTEGER' }] }]
          }]
        } as DatabaseSchema);
      }
      if (name === 'static') {
        return Promise.resolve({
          schemas: [
            { schema: 'finance', tables: [{ table: 'accounts', columns: [{ name: 'id', type: 'INTEGER' }] }] },
            { schema: 'kpi', tables: [{ table: 'kpi', columns: [{ name: 'id', type: 'INTEGER' }] }] },
            { schema: 's1', tables: [{ table: 't1', columns: [{ name: 'id', type: 'INTEGER' }] }] },
            { schema: 's2', tables: [{ table: 't2', columns: [{ name: 'id', type: 'INTEGER' }] }] }
          ]
        } as DatabaseSchema);
      }
      return Promise.resolve({ schemas: [] } as unknown as DatabaseSchema);
    });

    await mkConnection('main_wh');
    await mkConnection('static');
  });

  describe('same-length sibling directories', () => {
    let alfaCtxId: number;
    let betaCtxId: number;
    let deepCtxId: number;

    beforeEach(async () => {
      // Root: main_wh is for the BETA subtree, static is for the ALFA subtree.
      await mkContext('/org/context', {
        whitelist: [
          { name: 'main_wh', type: 'connection', children: [
            { name: 'core_data', type: 'schema', childPaths: ['/org/BETA'] }
          ]},
          { name: 'static', type: 'connection', children: [
            { name: 'finance', type: 'schema', childPaths: ['/org/ALFA'] },
            { name: 'kpi', type: 'schema', childPaths: ['/org/ALFA'] }
          ]}
        ],
        docs: [{ title: 'root-doc', content: 'for everyone' }]
      });

      // /org/ALFA and /org/BETA are SAME-LENGTH sibling directories.
      alfaCtxId = await mkContext('/org/ALFA/context', {
        whitelist: [
          { name: 'static', type: 'connection', children: [
            { name: 'finance', type: 'schema' },
            { name: 'kpi', type: 'schema' }
          ]}
        ],
        docs: [{ title: 'alfa-doc', content: 'ALFA only' }],
        views: [mkView('clean_kpi', { schema: 'kpi', table: 'kpi' })]
      });
      betaCtxId = await mkContext('/org/BETA/context', { whitelist: '*' });
      deepCtxId = await mkContext('/org/BETA/DEEP/context', { whitelist: '*' });

      // Ancestor candidates are scanned in updated_at DESC order. Make the WRONG
      // candidate (ALFA) the most recently updated one, so any matcher that
      // confuses same-length sibling directories deterministically picks it.
      await new Promise(r => setTimeout(r, 5));
      const alfa = await DocumentDB.getById(alfaCtxId);
      await DocumentDB.update(alfaCtxId, 'context', '/org/ALFA/context', alfa!.content as ContextContent, [], 'bump-alfa');
    });

    it('sanity: BETA inherits only what root offers its subtree', async () => {
      const beta = await loadContent(betaCtxId);
      expect(schemaNames(beta, 'main_wh')).toEqual(['core_data']);
      expect(schemaNames(beta, 'static')).toEqual([]);
    });

    it('a nested context inherits from its TRUE parent, not a same-length sibling directory', async () => {
      const deep = await loadContent(deepCtxId);
      // Through root → BETA, DEEP is offered main_wh/core_data and nothing of static.
      expect(schemaNames(deep, 'main_wh')).toEqual(['core_data']);
      expect(schemaNames(deep, 'static')).toEqual([]);
    });

    it('docs of a same-length sibling subtree never leak into a nested context', async () => {
      const deep = await loadContent(deepCtxId);
      const titles = (deep.fullDocs ?? []).map(d => d.title);
      expect(titles).toContain('root-doc');
      expect(titles).not.toContain('alfa-doc');
    });

    it('views of a same-length sibling subtree never leak into a nested context', async () => {
      const alfa = await loadContent(alfaCtxId);
      // The view is real and alive where it is defined…
      expect((alfa.viewProblems ?? [])).toEqual([]);
      // …but DEEP must not inherit it: ALFA is not its ancestor.
      const deep = await loadContent(deepCtxId);
      expect((deep.parentViews ?? []).map(v => v.name)).not.toContain('clean_kpi');
      expect(viewNames(deep)).not.toContain('clean_kpi');
    });
  });

  describe('strict chain — a grant must pass every level', () => {
    let midCtxId: number;
    let leafCtxId: number;

    beforeEach(async () => {
      await mkContext('/org/context', {
        whitelist: [
          { name: 'static', type: 'connection', children: [
            // Granted to the DEEP folder only, skipping the intermediate.
            { name: 's1', type: 'schema', childPaths: ['/org/AA/BB'] },
            // Granted to the intermediate's subtree — flows the whole way down.
            { name: 's2', type: 'schema', childPaths: ['/org/AA'] }
          ]}
        ]
      });
      midCtxId = await mkContext('/org/AA/context', { whitelist: '*' });
      leafCtxId = await mkContext('/org/AA/BB/context', { whitelist: '*' });
    });

    it('a grant scoped to a nested folder does not reach the intermediate folder', async () => {
      const mid = await loadContent(midCtxId);
      expect(schemaNames(mid, 'static')).toEqual(['s2']);
    });

    it('a grant scoped to a nested folder is blocked by the ungranted intermediate (strict chain)', async () => {
      const leaf = await loadContent(leafCtxId);
      // s1 names /org/AA/BB, but /org/AA was never offered it, so it cannot
      // flow through; s2 flows because the whole /org/AA subtree is granted.
      expect(schemaNames(leaf, 'static')).toEqual(['s2']);
    });
  });

  describe('view inheritance', () => {
    it('view childPaths scope to the named subtree: sibling excluded, grandchild included', async () => {
      await mkContext('/org/context', { whitelist: '*' });
      const parentId = await mkContext('/org/vp/context', {
        whitelist: '*',
        views: [
          mkView('v_scoped', { schema: 's1', table: 't1' }, ['/org/vp/kidA']),
          mkView('v_open', { schema: 's1', table: 't1' })
        ]
      });
      const kidAId = await mkContext('/org/vp/kidA/context', { whitelist: '*' });
      const kidBId = await mkContext('/org/vp/kidB/context', { whitelist: '*' });
      const grandId = await mkContext('/org/vp/kidA/gk/context', { whitelist: '*' });

      expect((await loadContent(parentId)).viewProblems ?? []).toEqual([]);
      expect(viewNames(await loadContent(kidAId)).sort()).toEqual(['v_open', 'v_scoped']);
      expect(viewNames(await loadContent(kidBId))).toEqual(['v_open']);
      expect(viewNames(await loadContent(grandId)).sort()).toEqual(['v_open', 'v_scoped']);
    });

    it('an explicit viewWhitelist declines the rest, and the decline cascades to grandchildren', async () => {
      await mkContext('/org/context', { whitelist: '*' });
      await mkContext('/org/vw/context', {
        whitelist: '*',
        views: [mkView('v1', { schema: 's1', table: 't1' }), mkView('v2', { schema: 's1', table: 't1' })]
      });
      const kidId = await mkContext('/org/vw/kid/context', { whitelist: '*', viewWhitelist: ['v1'] });
      const grandId = await mkContext('/org/vw/kid/gk/context', { whitelist: '*' });

      expect(viewNames(await loadContent(kidId))).toEqual(['v1']);
      const grand = await loadContent(grandId);
      // v2 was declined one level up: it is not even ON OFFER below that.
      expect((grand.parentViews ?? []).map(v => v.name)).toEqual(['v1']);
      expect(viewNames(grand)).toEqual(['v1']);
    });

    it('a view whose reads the chain no longer offers is disabled and never inherited (fail closed)', async () => {
      await mkContext('/org/context', {
        whitelist: [
          { name: 'static', type: 'connection', children: [{ name: 's1', type: 'schema' }] }
        ]
      });
      const parentId = await mkContext('/org/dis/context', {
        whitelist: '*',
        views: [mkView('v_bad', { schema: 's2', table: 't2' })]
      });
      const kidId = await mkContext('/org/dis/kid/context', { whitelist: '*' });

      const parent = await loadContent(parentId);
      expect((parent.viewProblems ?? []).map(p => p.view)).toEqual(['v_bad']);
      expect(schemaNames(parent, 'static')).not.toContain('_views');
      const kid = await loadContent(kidId);
      expect((kid.parentViews ?? []).map(v => v.name)).toEqual([]);
      expect(viewNames(kid)).toEqual([]);
    });

    it('the parent\'s injected _views schema is never inherited as a raw schema', async () => {
      await mkContext('/org/context', { whitelist: '*' });
      const parentId = await mkContext('/org/vs/context', {
        whitelist: '*',
        views: [mkView('v_ok', { schema: 's1', table: 't1' })]
      });
      const kidId = await mkContext('/org/vs/kid/context', { whitelist: '*', viewWhitelist: [] });

      // The parent's own fullSchema carries the view as a _views table…
      expect(schemaNames(await loadContent(parentId), 'static')).toContain('_views');
      // …but a child that declined every view must not receive _views as if it
      // were an ordinary inherited schema.
      const kid = await loadContent(kidId);
      expect(viewNames(kid)).toEqual([]);
      expect(schemaNames(kid, 'static')).not.toContain('_views');
    });
  });

  describe('doc inheritance', () => {
    it('docs scoped to a dead path or an empty childPaths list reach nobody; unscoped docs reach everyone', async () => {
      await mkContext('/org/context', {
        whitelist: '*',
        docs: [
          { title: 'd_dead', content: 'x', childPaths: ['/org/nonexistent'] },
          { title: 'd_none', content: 'x', childPaths: [] },
          { title: 'd_all', content: 'x' }
        ]
      });
      const kidId = await mkContext('/org/docs-kid/context', { whitelist: '*' });

      const titles = ((await loadContent(kidId)).fullDocs ?? []).map(d => d.title);
      expect(titles).toEqual(['d_all']);
    });
  });

  describe('semantic model inheritance', () => {
    it('model childPaths scope like views, and an explicit whitelist decline cascades', async () => {
      await mkContext('/org/context', { whitelist: '*' });
      await mkContext('/org/sm/context', {
        whitelist: '*',
        semanticModels: [mkModel('m_scoped', ['/org/sm/a']), mkModel('m_open')]
      });
      const aId = await mkContext('/org/sm/a/context', { whitelist: '*', semanticModelWhitelist: [] });
      const bId = await mkContext('/org/sm/b/context', { whitelist: '*' });
      const grandId = await mkContext('/org/sm/a/gk/context', { whitelist: '*' });

      const a = await loadContent(aId);
      // Both halves visible at the declining level: offered, but taken nothing.
      expect((a.parentSemanticModels ?? []).map(m => m.name).sort()).toEqual(['m_open', 'm_scoped']);
      expect((a.fullSemanticModels ?? []).map(m => m.name)).toEqual([]);

      const b = await loadContent(bId);
      expect((b.fullSemanticModels ?? []).map(m => m.name)).toEqual(['m_open']);

      // The decline cascades: nothing is on offer below the declining context.
      const grand = await loadContent(grandId);
      expect((grand.parentSemanticModels ?? []).map(m => m.name)).toEqual([]);
      expect((grand.fullSemanticModels ?? []).map(m => m.name)).toEqual([]);
    });
  });

  describe('relative childPaths — resolved against the granting context folder', () => {
    it('a relative whitelist grant scopes exactly like its absolute form', async () => {
      await mkContext('/org/context', {
        whitelist: [
          { name: 'static', type: 'connection', children: [
            { name: 's1', type: 'schema', childPaths: ['relA'] },
            { name: 's2', type: 'schema', childPaths: ['/org/relB'] }
          ]}
        ]
      });
      const aId = await mkContext('/org/relA/context', { whitelist: '*' });
      const bId = await mkContext('/org/relB/context', { whitelist: '*' });

      expect(schemaNames(await loadContent(aId), 'static')).toEqual(['s1']);
      expect(schemaNames(await loadContent(bId), 'static')).toEqual(['s2']);
    });

    it('relative doc/view/model scoping reaches grandchildren through the computed plane', async () => {
      await mkContext('/org/context', { whitelist: '*' });
      await mkContext('/org/rp/context', {
        whitelist: '*',
        docs: [{ title: 'rp-doc', content: 'x', childPaths: ['kidA'] }],
        views: [mkView('rp_view', { schema: 's1', table: 't1' }, ['kidA'])],
        semanticModels: [mkModel('rp_model', ['kidA'])]
      });
      const kidAId = await mkContext('/org/rp/kidA/context', { whitelist: '*' });
      const kidBId = await mkContext('/org/rp/kidB/context', { whitelist: '*' });
      const grandId = await mkContext('/org/rp/kidA/gk/context', { whitelist: '*' });

      const kidA = await loadContent(kidAId);
      expect((kidA.fullDocs ?? []).map(d => d.title)).toContain('rp-doc');
      expect(viewNames(kidA)).toContain('rp_view');
      expect((kidA.fullSemanticModels ?? []).map(m => m.name)).toContain('rp_model');

      const kidB = await loadContent(kidBId);
      expect((kidB.fullDocs ?? []).map(d => d.title)).not.toContain('rp-doc');
      expect(viewNames(kidB)).not.toContain('rp_view');

      // The scoped entries survive the extra inheritance hop: the computed plane
      // carries them absolutized, so the grandchild's re-check still passes.
      const grand = await loadContent(grandId);
      expect((grand.fullDocs ?? []).map(d => d.title)).toContain('rp-doc');
      expect(viewNames(grand)).toContain('rp_view');
      expect((grand.fullSemanticModels ?? []).map(m => m.name)).toContain('rp_model');
    });
  });

  describe('folder move and rename — scoped childPaths rewrites', () => {
    async function createFolder(path: string): Promise<number> {
      const name = path.split('/').pop()!;
      const result = await FilesAPI.createFile({ name, path, type: 'folder', content: { name } }, user);
      return result.data.id;
    }

    beforeEach(async () => {
      await DocumentDB.create('org', '/org', 'folder', { name: 'org' }, []);
    });

    it('renaming a granted folder keeps the grant working (relative entry follows the folder)', async () => {
      await mkContext('/org/context', {
        whitelist: [
          { name: 'static', type: 'connection', children: [
            { name: 's1', type: 'schema', childPaths: ['ren-old'] }
          ]}
        ]
      });
      const srcId = await createFolder('/org/ren-old');

      await FilesAPI.moveFile({ id: srcId, name: 'ren-new', newPath: '/org/ren-new' }, user);

      const root = (await DocumentDB.getByPath('/org/context'))!.content as ContextContent;
      const staticNode = (root.versions![0].whitelist as Array<{ name: string; children?: Array<{ name: string; childPaths?: string[] }> }>)[0];
      expect(staticNode.children![0].childPaths).toEqual(['ren-new']);

      const renamedCtx = await DocumentDB.getByPath('/org/ren-new/context');
      expect(schemaNames(await loadContent(renamedCtx!.id), 'static')).toEqual(['s1']);
    });

    it('moving within the grantor subtree follows the folder; leaving it goes inert untouched', async () => {
      // Grantor of both: root (ancestor of old AND new location) — entry follows.
      await mkContext('/org/context', {
        whitelist: [
          { name: 'static', type: 'connection', children: [
            { name: 's1', type: 'schema', childPaths: ['mv-src'] }
          ]}
        ]
      });
      // Grantor the folder is LEAVING: its context content must not change.
      const srcId = await createFolder('/org/mv-src');
      await createFolder('/org/mv-src/inner');
      const srcCtx = await DocumentDB.getByPath('/org/mv-src/context');
      const srcContent = {
        ...(srcCtx!.content as Record<string, unknown>),
        versions: [{
          version: 1,
          whitelist: '*',
          docs: [
            { title: 'rel-doc', content: 'x', childPaths: ['inner'] },
            { title: 'abs-doc', content: 'x', childPaths: ['/org/mv-src/inner'] }
          ],
          createdAt: new Date().toISOString(),
          createdBy: 1
        }],
        published: { all: 1 }
      };
      await DocumentDB.update(srcCtx!.id, 'context', '/org/mv-src/context', srcContent, [], 'seed-mv-src');
      await createFolder('/org/mv-dest');

      await FilesAPI.moveFile({ id: srcId, name: 'mv-src', newPath: '/org/mv-dest/mv-src' }, user);

      // Root remained an ancestor: its relative entry tracked the folder.
      const root = (await DocumentDB.getByPath('/org/context'))!.content as ContextContent;
      const staticNode = (root.versions![0].whitelist as Array<{ name: string; children?: Array<{ name: string; childPaths?: string[] }> }>)[0];
      expect(staticNode.children![0].childPaths).toEqual(['mv-dest/mv-src']);

      // Inside the moved subtree: relative entries untouched (targets moved along);
      // legacy absolute entries prefix-rewritten so they stay valid.
      const moved = (await DocumentDB.getByPath('/org/mv-dest/mv-src/context'))!.content as ContextContent;
      const docs = moved.versions![0].docs as Array<{ title?: string; childPaths?: string[] }>;
      expect(docs.find(d => d.title === 'rel-doc')!.childPaths).toEqual(['inner']);
      expect(docs.find(d => d.title === 'abs-doc')!.childPaths).toEqual(['/org/mv-dest/mv-src/inner']);
    });

    it('a grant whose target leaves the grantor subtree stays byte-identical (inert, user-owned)', async () => {
      await mkContext('/org/context', { whitelist: '*' });
      await createFolder('/org/out-base');
      const innerId = await createFolder('/org/out-base/inner');
      const baseCtx = await DocumentDB.getByPath('/org/out-base/context');
      const baseContent = {
        ...(baseCtx!.content as Record<string, unknown>),
        versions: [{
          version: 1,
          whitelist: '*',
          docs: [
            { title: 'rel-doc', content: 'x', childPaths: ['inner'] },
            // The legacy absolute form is the canary for over-broad rewrite
            // scoping: a relative entry that cannot be re-expressed falls back
            // to itself, but an absolute one WOULD be corrupted.
            { title: 'abs-doc', content: 'x', childPaths: ['/org/out-base/inner'] }
          ],
          createdAt: new Date().toISOString(),
          createdBy: 1
        }],
        published: { all: 1 }
      };
      await DocumentDB.update(baseCtx!.id, 'context', '/org/out-base/context', baseContent, [], 'seed-out-base');
      await createFolder('/org/elsewhere');

      await FilesAPI.moveFile({ id: innerId, name: 'inner', newPath: '/org/elsewhere/inner' }, user);

      // out-base can no longer reach the folder; its content is NOT rewritten.
      const base = (await DocumentDB.getByPath('/org/out-base/context'))!.content as ContextContent;
      const docs = base.versions![0].docs as Array<{ title?: string; childPaths?: string[] }>;
      expect(docs.find(d => d.title === 'rel-doc')!.childPaths).toEqual(['inner']);
      expect(docs.find(d => d.title === 'abs-doc')!.childPaths).toEqual(['/org/out-base/inner']);
    });
  });
});
