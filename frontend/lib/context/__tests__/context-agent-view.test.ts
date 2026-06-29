// What the AGENT sees + may edit on a context file.
//
// shapeContextForAgent: drops the resolved `fullSchema` and reduces `parentSchema` (the menu of
// tables available to whitelist) to NAMES ONLY, so a big DB's schema cache doesn't bloat the markup
// every turn — columns come on demand via SearchDBSchema. The inherited menus (fullDocs/…) stay.
//
// contextEditWithinBounds: the EditFile guard — the agent may change a version's authored fields
// (whitelist, docs, metrics, annotations, description); version identity / the published pointer may
// not change, and the server-computed fields are ignored (re-derived on load).
import { shapeContextForAgent, contextEditWithinBounds } from '@/lib/context/context-agent-view';

const schemaWithCols = [
  { databaseName: 'wh', schemas: [
    { schema: 'sales', tables: [
      { table: 'orders', columns: [{ name: 'id' }, { name: 'amount' }] },
      { table: 'customers', columns: [{ name: 'id' }, { name: 'email' }] },
    ] },
  ] },
];

const ctx = () => ({
  versions: [{ version: 1, whitelist: [{ name: 'wh', type: 'connection', children: [] }], docs: [{ title: 'Sales', body: 'x' }], description: 'v1' }],
  published: { all: 1 },
  fullSchema: schemaWithCols,
  parentSchema: schemaWithCols,
  fullDocs: [{ title: 'Inherited', body: 'from parent' }],
  fullMetrics: [{ name: 'Revenue' }],
  fullSkills: [{ name: 'skill1' }],
});

describe('shapeContextForAgent', () => {
  it('drops the resolved fullSchema entirely', () => {
    expect('fullSchema' in shapeContextForAgent(ctx())).toBe(false);
  });

  it('reduces parentSchema to names only (no columns)', () => {
    const shaped: any = shapeContextForAgent(ctx());
    const table = shaped.parentSchema[0].schemas[0].tables[0];
    expect(table.table).toBe('orders');
    expect('columns' in table).toBe(false);
    // schema + table names preserved so the agent knows what's available to whitelist
    expect(shaped.parentSchema[0].schemas[0].schema).toBe('sales');
    expect(shaped.parentSchema[0].schemas[0].tables.map((t: any) => t.table)).toEqual(['orders', 'customers']);
  });

  it('keeps the editable fields and the inherited menus', () => {
    const shaped: any = shapeContextForAgent(ctx());
    expect(shaped.versions[0].whitelist).toBeTruthy();
    expect(shaped.versions[0].docs[0].title).toBe('Sales');
    expect(shaped.fullDocs[0].title).toBe('Inherited');
    expect(shaped.fullMetrics[0].name).toBe('Revenue');
    expect(shaped.fullSkills[0].name).toBe('skill1');
  });

  it('does not mutate the input', () => {
    const input = ctx();
    shapeContextForAgent(input);
    expect(input.fullSchema).toBe(schemaWithCols);
    expect((input.parentSchema as any)[0].schemas[0].tables[0].columns).toBeTruthy();
  });
});

describe('contextEditWithinBounds', () => {
  it('allows editing a version whitelist / docs / description', () => {
    const a = ctx();
    const wl = structuredClone(a); wl.versions[0].whitelist = [{ name: 'wh', type: 'connection', children: [{ name: 'sales', type: 'schema', children: [{ name: 'orders', type: 'table' }] }] }] as any;
    expect(contextEditWithinBounds(a, wl)).toBe(true);
    const dc = structuredClone(a); dc.versions[0].docs = [{ title: 'New', body: 'y' }];
    expect(contextEditWithinBounds(a, dc)).toBe(true);
    const ds = structuredClone(a); ds.versions[0].description = 'edited';
    expect(contextEditWithinBounds(a, ds)).toBe(true);
  });

  it('ignores changes to the server-computed fields (re-derived on load)', () => {
    const a = ctx();
    const b = structuredClone(a); b.fullSchema = []; b.parentSchema = []; b.fullDocs = [];
    expect(contextEditWithinBounds(a, b)).toBe(true);
  });

  it('blocks changing the published pointer or version identity', () => {
    const a = ctx();
    const pub = structuredClone(a); pub.published = { all: 2 };
    expect(contextEditWithinBounds(a, pub)).toBe(false);
    const ver = structuredClone(a); ver.versions[0].version = 2;
    expect(contextEditWithinBounds(a, ver)).toBe(false);
  });
});
