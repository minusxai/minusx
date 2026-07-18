import { MIGRATIONS, applyMigrations, fixData } from '../migrations';
import { MINIMUM_SUPPORTED_DATA_VERSION, LATEST_DATA_VERSION } from '../constants';
import type { InitData, OrgData } from '../import-export';
import type { DbFile } from '../../types';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeDoc(id: number, overrides: Partial<DbFile> = {}): DbFile {
  return {
    id,
    name: `doc-${id}`,
    path: `/org/doc-${id}`,
    type: 'question',
    content: { query: '', vizSettings: { type: 'table' }, connection_name: '' } as any,
    references: [],
    version: 1,
    last_edit_id: null,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    ...overrides,
  };
}

function makeDashboard(id: number, assetIds: number[], layoutIds: number[] = assetIds): DbFile {
  return makeDoc(id, {
    type: 'dashboard',
    content: {
      assets: assetIds.map(aid => ({ type: 'question', id: aid })),
      layout: layoutIds.map((lid, i) => ({ id: lid, x: i, y: 0, w: 4, h: 4 })),
    } as any,
  });
}

function makeStory(id: number, embedIds: number[], paramSourceId?: number): DbFile {
  const embeds = embedIds.map(eid => `<div data-question-id="${eid}" style="width:100%;height:420px"></div>`).join('');
  const param = paramSourceId != null
    ? `<div data-param-name="region" data-param-type="text" data-param-nullable="true" data-param-source-id="${paramSourceId}" data-param-source-col="region"></div>`
    : '';
  return makeDoc(id, {
    type: 'story',
    content: { description: null, story: `<div class="story">${param}${embeds}</div>` } as any,
  });
}

function initData(documents: DbFile[], version = 35): InitData {
  return { version, users: [], documents };
}

// ──────────────────────────────────────────────────────────────────────────────
// Migration registry
// ──────────────────────────────────────────────────────────────────────────────

describe('Migration registry', () => {
  it('contains exactly the V36 and V37 migrations, in order', () => {
    expect(MIGRATIONS).toHaveLength(2);
    expect(MIGRATIONS.map(m => m.dataVersion)).toEqual([36, 37]);
  });

  it('MINIMUM_SUPPORTED_DATA_VERSION stays 35 (v35 exports migrate through the chain)', () => {
    expect(MINIMUM_SUPPORTED_DATA_VERSION).toBe(35);
    expect(LATEST_DATA_VERSION).toBe(37);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// applyMigrations
// ──────────────────────────────────────────────────────────────────────────────

describe('applyMigrations', () => {
  it('clamps any version below MINIMUM_SUPPORTED_DATA_VERSION to minimum and runs migrations', () => {
    // Versions below minimum (including 0 for unversioned DBs) are clamped — never thrown.
    const data: InitData = { version: 0, users: [], documents: [makeDoc(500)] };
    const result = applyMigrations(data, 0);
    expect(result.version).toBe(LATEST_DATA_VERSION);
    expect(result.documents![0].id).toBe(1000); // V36 ran
  });

  it('accepts data at MINIMUM_SUPPORTED_DATA_VERSION without throwing', () => {
    const data: InitData = { version: LATEST_DATA_VERSION, users: [], documents: [] };
    expect(() => applyMigrations(data, MINIMUM_SUPPORTED_DATA_VERSION)).not.toThrow();
  });

  it('returns data unchanged (modulo fixData) when already at latest version', () => {
    const data: InitData = { version: LATEST_DATA_VERSION, users: [], documents: [] };
    const result = applyMigrations(data, LATEST_DATA_VERSION);
    expect(result.version).toBe(LATEST_DATA_VERSION);
    expect(result.documents).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// V36 — v36ShiftUserFileIds (exercised via applyMigrations from v35)
// ──────────────────────────────────────────────────────────────────────────────

describe('V36: shift all non-system file IDs to ≥ 1000', () => {
  function migrate(documents: DbFile[]): DbFile[] {
    const result = applyMigrations(initData(documents), 35);
    return result.documents!;
  }

  // ── No-ops ──────────────────────────────────────────────────────────────────

  it('is a no-op when all user docs already have IDs ≥ 1000', () => {
    const docs = [makeDoc(1000), makeDoc(1050)];
    const result = migrate(docs);
    expect(result.map(d => d.id)).toEqual([1000, 1050]);
  });

  it('is a no-op when the only docs below 1000 are system template docs (tutorial IDs 1 and 2)', () => {
    // IDs 1 and 2 are tutorial/system template docs — they must never be shifted
    const docs = [makeDoc(1), makeDoc(2)];
    const result = migrate(docs);
    expect(result.map(d => d.id)).toEqual([1, 2]);
  });

  // ── /org files (100–112) are shifted ─────────────────────────────────────────

  it('shifts /org files (formerly 100–112) since they are no longer system template IDs', () => {
    // 103 = /org folder in old template; no longer in TEMPLATE_IDS after template update
    const docs = [makeDoc(103), makeDoc(106)]; // /org, /org/database
    const result = migrate(docs);
    const ids = result.map(d => d.id).sort((a, b) => a - b);
    expect(ids[0]).toBeGreaterThanOrEqual(1000);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
  });

  it('preserves relative spacing when shifting /org files', () => {
    // min=103, offset=897: 103→1000, 112→1009
    const docs = [makeDoc(103), makeDoc(112)];
    const result = migrate(docs);
    expect(result.map(d => d.id)).toEqual([1000, 1009]);
  });

  it('shifts /org files while leaving system tutorial files untouched', () => {
    const docs = [makeDoc(1), makeDoc(103), makeDoc(112)];
    const result = migrate(docs);
    const byOldId = Object.fromEntries(docs.map((d, i) => [d.id, result[i]]));
    expect(byOldId[1].id).toBe(1);      // tutorial — untouched
    expect(byOldId[103].id).toBe(1000); // /org — shifted
    expect(byOldId[112].id).toBe(1009); // /org/logs/conversations/context — shifted
  });

  it('bumps data version to the latest (37) from 35 through the chain', () => {
    const result = applyMigrations(initData([makeDoc(500)]), 35);
    expect(result.version).toBe(37);
  });

  // ── ID remapping ─────────────────────────────────────────────────────────────

  it('shifts a single user doc with the lowest ID landing exactly at 1000', () => {
    const result = migrate([makeDoc(500)]);
    expect(result[0].id).toBe(1000);
  });

  it('preserves relative spacing: [500, 501, 600] → [1000, 1001, 1100]', () => {
    const result = migrate([makeDoc(500), makeDoc(501), makeDoc(600)]);
    expect(result.map(d => d.id)).toEqual([1000, 1001, 1100]);
  });

  it('does not shift a user doc that already has ID ≥ 1000, and places the shifted doc above it', () => {
    // doc at 1500 stays; floor = max(1000, 1500+1) = 1501, so 500 → 1501
    const result = migrate([makeDoc(500), makeDoc(1500)]);
    const ids = result.map(d => d.id).sort((a, b) => a - b);
    expect(ids).toEqual([1500, 1501]);
  });

  // ── No conflicting IDs after migration ───────────────────────────────────────

  it('produces no duplicate IDs in the normal case', () => {
    const docs = [makeDoc(500), makeDoc(501), makeDoc(600)];
    const result = migrate(docs);
    const ids = result.map(d => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('produces no duplicate IDs when a user doc already occupies the shifted target', () => {
    // 500 would shift to 1000 (offset=500), but 1000 already exists as another user doc
    const docs = [makeDoc(500), makeDoc(1000)];
    const result = migrate(docs);
    const ids = result.map(d => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('produces no duplicate IDs when multiple existing ≥1000 docs conflict with shifts', () => {
    // min=500, offset=500: 500→1000, 600→1100; but 1000 and 1100 are already taken
    const docs = [makeDoc(500), makeDoc(600), makeDoc(1000), makeDoc(1100)];
    const result = migrate(docs);
    const ids = result.map(d => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // ── System template IDs (1–99) never shifted ────────────────────────────────

  it('leaves system template docs (IDs 1, 2) in place even when mixed with other docs', () => {
    const docs = [makeDoc(1), makeDoc(2), makeDoc(500)];
    const result = migrate(docs);
    const byOldId = Object.fromEntries(docs.map((d, i) => [d.id, result[i]]));
    expect(byOldId[1].id).toBe(1);      // system template — untouched
    expect(byOldId[2].id).toBe(2);      // system template — untouched
    expect(byOldId[500].id).toBe(1000); // non-system doc — shifted
  });

  // ── doc.references remapping ─────────────────────────────────────────────────

  it('remaps references pointing to shifted user docs', () => {
    const docs = [
      makeDoc(500),
      makeDoc(501, { references: [500] }),
    ];
    const result = migrate(docs);
    const folder = result.find(d => d.id === 1001)!;
    expect(folder.references).toEqual([1000]);
  });

  it('does not remap references pointing to template docs', () => {
    const docs = [
      makeDoc(1),                          // template doc
      makeDoc(500, { references: [1] }),   // user doc referencing template
    ];
    const result = migrate(docs);
    const userDoc = result.find(d => d.id === 1000)!;
    expect(userDoc.references).toEqual([1]); // template ref unchanged
  });

  it('remaps mixed references (some template, some user)', () => {
    const docs = [
      makeDoc(1),   // template
      makeDoc(500), // user
      makeDoc(501, { references: [1, 500] }),
    ];
    const result = migrate(docs);
    const refDoc = result.find(d => d.id === 1001)!;
    expect(refDoc.references).toEqual([1, 1000]); // template ref 1 stays, 500→1000
  });

  // ── Dashboard content: assets[] ───────────────────────────────────────────────

  it('remaps dashboard asset IDs for shifted user docs', () => {
    const docs = [
      makeDoc(500),
      makeDashboard(501, [500]),
    ];
    const result = migrate(docs);
    const dash = result.find(d => d.id === 1001)!;
    const content = dash.content as any;
    expect(content.assets[0].id).toBe(1000);
  });

  it('does not remap dashboard asset IDs for template docs', () => {
    const docs = [
      makeDoc(1),            // template question
      makeDashboard(500, [1]),
    ];
    const result = migrate(docs);
    const dash = result.find(d => d.id === 1000)!;
    const content = dash.content as any;
    expect(content.assets[0].id).toBe(1); // template ref unchanged
  });

  it('remaps dashboard assets with mixed template and user IDs', () => {
    const docs = [
      makeDoc(1),
      makeDoc(500),
      makeDashboard(501, [1, 500]),
    ];
    const result = migrate(docs);
    const dash = result.find(d => d.id === 1001)!;
    const content = dash.content as any;
    expect(content.assets.map((a: any) => a.id)).toEqual([1, 1000]);
  });

  // ── Story content: body embeds (the body is the source of truth — no assets field) ──

  it('remaps a story body\'s data-question-id embeds for shifted user docs', () => {
    const docs = [makeDoc(500), makeStory(501, [500])];
    const result = migrate(docs);
    const story = result.find(d => d.id === 1001)!;
    expect((story.content as any).story).toContain('data-question-id="1000"');
    expect((story.content as any).story).not.toContain('data-question-id="500"');
  });

  it('remaps a story <Param> import source id (data-param-source-id) too', () => {
    const docs = [makeDoc(500), makeStory(501, [500], 500)];
    const result = migrate(docs);
    const story = result.find(d => d.id === 1001)!;
    expect((story.content as any).story).toContain('data-param-source-id="1000"');
  });

  it('does not remap a story body embed pointing at a template doc', () => {
    const docs = [makeDoc(1), makeStory(500, [1])];
    const result = migrate(docs);
    const story = result.find(d => d.id === 1000)!;
    expect((story.content as any).story).toContain('data-question-id="1"'); // template ref unchanged
  });

  // ── Dashboard content: layout[] ───────────────────────────────────────────────

  it('remaps dashboard layout IDs for shifted user docs', () => {
    const docs = [
      makeDoc(500),
      makeDashboard(501, [500]),
    ];
    const result = migrate(docs);
    const dash = result.find(d => d.id === 1001)!;
    const content = dash.content as any;
    expect(content.layout[0].id).toBe(1000);
  });

  it('preserves other layout fields when remapping', () => {
    const docs = [
      makeDoc(500),
      makeDashboard(501, [500], [500]),
    ];
    const result = migrate(docs);
    const dash = result.find(d => d.id === 1001)!;
    const content = dash.content as any;
    expect(content.layout[0]).toMatchObject({ id: 1000, x: 0, y: 0, w: 4, h: 4 });
  });

  it('does not remap layout IDs for template docs', () => {
    const docs = [
      makeDoc(1),
      makeDashboard(500, [1], [1]),
    ];
    const result = migrate(docs);
    const dash = result.find(d => d.id === 1000)!;
    const content = dash.content as any;
    expect(content.layout[0].id).toBe(1);
  });

  // ── Legacy nested `orgs` format ──────────────────────────────────────────────

  it('handles the legacy nested orgs format', () => {
    const org: OrgData = {
      id: 1, name: 'org', display_name: 'Org',
      created_at: '2024-01-01', updated_at: '2024-01-01',
      users: [],
      documents: [makeDoc(500), makeDoc(501, { references: [500] })],
    };
    const data: InitData = { version: 35, orgs: [org] };
    const result = applyMigrations(data, 35);

    const docs = result.orgs![0].documents;
    expect(docs.map(d => d.id)).toEqual([1000, 1001]);
    expect(docs[1].references).toEqual([1000]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// fixData
// ──────────────────────────────────────────────────────────────────────────────

describe('fixData', () => {
  it('adds missing pivotConfig to pivot questions', () => {
    const data: InitData = {
      version: LATEST_DATA_VERSION,
      users: [],
      documents: [{
        id: 1000, name: 'q', path: '/org/q', type: 'question',
        content: { query: '', vizSettings: { type: 'pivot' }, connection_name: '' } as any,
        references: [], version: 1, last_edit_id: null,
        created_at: '2024-01-01', updated_at: '2024-01-01',
      }],
    };
    const result = fixData(data);
    const viz = (result.documents![0].content as any).vizSettings;
    expect(viz.pivotConfig).toEqual({ rows: [], columns: [], values: [] });
  });

  it('normalizes a non-array references to an empty array', () => {
    const data: InitData = {
      version: LATEST_DATA_VERSION,
      users: [],
      documents: [makeDoc(1000, { references: {} as any })],
    };
    const result = fixData(data);
    expect(result.documents![0].references).toEqual([]);
  });

  it('normalizes references even on a doc with no content (runs before the content skip)', () => {
    const data: InitData = {
      version: LATEST_DATA_VERSION,
      users: [],
      documents: [makeDoc(1000, { content: null as any, references: {} as any })],
    };
    const result = fixData(data);
    expect(result.documents![0].references).toEqual([]);
  });

  it('leaves a valid references array untouched', () => {
    const data: InitData = {
      version: LATEST_DATA_VERSION,
      users: [],
      documents: [makeDoc(1000, { references: [5, 6] })],
    };
    const result = fixData(data);
    expect(result.documents![0].references).toEqual([5, 6]);
  });
});

// fixData runs unconditionally at the end of applyMigrations, so references are
// normalized even when no versioned migration runs (e.g. a DB already at latest).
describe('applyMigrations — references normalized when no migration runs', () => {
  it('normalizes a non-array references at the latest version (V36 skipped)', () => {
    const data: InitData = {
      version: LATEST_DATA_VERSION,
      users: [],
      documents: [makeDoc(1500, { references: {} as any })],
    };
    const result = applyMigrations(data, LATEST_DATA_VERSION);
    expect(result.documents![0].references).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// V36 — malformed `references` must not crash the whole migration
// ──────────────────────────────────────────────────────────────────────────────

describe('applyMigrations — non-array file_references (regression)', () => {
  // Legacy/bad rows can have a non-array JSONB `file_references` (e.g. {}).
  // `?? []` only guards null/undefined, so V36 used to throw
  // "(references ?? []).map is not a function" and 500 the entire migrate-db run.
  it('does not throw when a document has a non-array references value', () => {
    const data: InitData = {
      version: 35,
      users: [],
      documents: [makeDoc(500, { references: {} as any })],
    };
    expect(() => applyMigrations(data, 35)).not.toThrow();
  });

  it('normalizes a non-array references to an empty array and still shifts the id', () => {
    const data: InitData = {
      version: 35,
      users: [],
      documents: [makeDoc(500, { references: {} as any })],
    };
    const result = applyMigrations(data, 35);
    expect(result.documents![0].references).toEqual([]);
    expect(result.documents![0].id).toBe(1000); // V36 still ran
  });

  it('still remaps a valid references array', () => {
    // Two user docs <1000: ids 500 and 501 → shifted to 1000 and 1001.
    // Doc 500 references 501, which must be remapped to 1001.
    const data: InitData = {
      version: 35,
      users: [],
      documents: [makeDoc(500, { references: [501] }), makeDoc(501)],
    };
    const result = applyMigrations(data, 35);
    const shifted = result.documents!.find(d => d.name === 'doc-500')!;
    expect(shifted.references).toEqual([1001]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// V37 — file-level Viz V2 envelopes (no query execution; heuristic kinds)
// ──────────────────────────────────────────────────────────────────────────────

describe('v37 — add viz envelopes to questions and notebook cells', () => {
  const v37 = MIGRATIONS.find(m => m.dataVersion === 37)!.dataMigration!;

  it('adds a viz derived from vizSettings; vizSettings stays byte-identical', () => {
    const vizSettings = { type: 'bar', xCols: ['region'], yCols: ['revenue'] };
    // Snapshot BEFORE migrating — comparing against the live object would be a
    // tautology (an in-place mutation would change both sides identically).
    const before = structuredClone(vizSettings);
    const doc = makeDoc(1, { content: { query: 'SELECT 1', vizSettings, connection_name: 'db' } as any });
    const out = v37(initData([doc], 36));
    const c = out.documents![0].content as any;
    expect(c.viz?.version).toBe(2);
    expect(c.viz.source.kind).toBe('vega-lite');
    expect(c.vizSettings).toEqual(before);
  });

  it('never overwrites an existing viz', () => {
    const viz = { version: 2, source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: null } };
    const doc = makeDoc(1, { content: { query: '', vizSettings: { type: 'bar' }, viz, connection_name: '' } as any });
    const out = v37(initData([doc], 36));
    expect((out.documents![0].content as any).viz).toEqual(viz);
  });

  it('upgrades notebook SQL cells (text cells untouched)', () => {
    const doc = makeDoc(1, {
      type: 'notebook',
      content: {
        description: null,
        cells: [
          { type: 'sql', id: 'c1', name: null, query: 'SELECT 1', vizSettings: { type: 'line', xCols: ['order_date'], yCols: ['n'] }, parameters: [], parameterValues: {}, connection_name: 'db' },
          { type: 'text', id: 'c2', name: null, content: 'hello' },
        ],
      } as any,
    });
    const out = v37(initData([doc], 36));
    const cells = (out.documents![0].content as any).cells;
    expect(cells[0].viz?.version).toBe(2);
    expect(cells[0].vizSettings).toEqual({ type: 'line', xCols: ['order_date'], yCols: ['n'] });
    expect(cells[1].viz).toBeUndefined();
    expect(cells[1].content).toBe('hello');
  });
});
