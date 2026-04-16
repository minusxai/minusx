import { MIGRATIONS } from '../migrations';
import type { InitData, CompanyData, ExportedDocument } from '../import-export';
import type { Whitelist } from '@/lib/types';

const migrate = MIGRATIONS.find(m => m.dataVersion === 33)!.dataMigration!;

function makeDoc(overrides: Partial<ExportedDocument>): ExportedDocument {
  return {
    id: 1,
    name: 'context',
    path: '/org/context',
    type: 'context',
    content: {},
    references: [],
    version: 1,
    last_edit_id: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    company_id: 1,
    ...overrides,
  };
}

function makeData(documents: ExportedDocument[]): InitData {
  const company: CompanyData = {
    id: 1, name: 'test', display_name: 'Test', subdomain: null,
    created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
    users: [], documents,
  };
  return { companies: [company] } as unknown as InitData;
}

function getContextVersions(data: InitData, path: string): any[] | undefined {
  const docs = (data.companies[0] as CompanyData).documents;
  const doc = docs.find(d => d.path === path);
  return (doc?.content as any)?.versions;
}

function getContextPaths(data: InitData): string[] {
  return (data.companies[0] as CompanyData).documents
    .filter(d => d.type === 'context')
    .map(d => d.path);
}

// ─── Part A: whitelist conversion ───────────────────────────────────────────

describe('V33 migration — Part A: databases[] → whitelist tree', () => {
  it('converts a schema-level whitelist item to a connection node with schema child', () => {
    const data = makeData([makeDoc({
      content: {
        versions: [{
          version: 1,
          databases: [{
            databaseName: 'mydb',
            whitelist: [{ name: 'public', type: 'schema' }],
          }],
          docs: [],
        }],
        published: { all: 1 },
      } as any,
    })]);

    const result = migrate(data);
    const versions = getContextVersions(result, '/org/context')!;
    expect(versions[0].whitelist).toEqual([{
      name: 'mydb',
      type: 'connection',
      children: [{ name: 'public', type: 'schema' }], // no children = expose all tables
    }]);
    expect(versions[0].databases).toBeUndefined();
  });

  it('converts table-level whitelist items, grouped by schema', () => {
    const data = makeData([makeDoc({
      content: {
        versions: [{
          version: 1,
          databases: [{
            databaseName: 'mydb',
            whitelist: [
              { name: 'orders', type: 'table', schema: 'public' },
              { name: 'users', type: 'table', schema: 'public' },
              { name: 'products', type: 'table', schema: 'catalog' },
            ],
          }],
          docs: [],
        }],
        published: { all: 1 },
      } as any,
    })]);

    const result = migrate(data);
    const versions = getContextVersions(result, '/org/context')!;
    const connNode = versions[0].whitelist[0];
    expect(connNode.name).toBe('mydb');
    expect(connNode.type).toBe('connection');

    const publicSchema = connNode.children.find((c: any) => c.name === 'public');
    expect(publicSchema).toBeDefined();
    expect(publicSchema.children.map((t: any) => t.name)).toEqual(
      expect.arrayContaining(['orders', 'users'])
    );

    const catalogSchema = connNode.children.find((c: any) => c.name === 'catalog');
    expect(catalogSchema).toBeDefined();
    expect(catalogSchema.children.map((t: any) => t.name)).toContain('products');

    expect(versions[0].databases).toBeUndefined();
  });

  it('converts an empty whitelist to a connection node with children: []', () => {
    const data = makeData([makeDoc({
      content: {
        versions: [{
          version: 1,
          databases: [{ databaseName: 'mydb', whitelist: [] }],
          docs: [],
        }],
        published: { all: 1 },
      } as any,
    })]);

    const result = migrate(data);
    const versions = getContextVersions(result, '/org/context')!;
    expect(versions[0].whitelist).toEqual([{
      name: 'mydb', type: 'connection', children: [],
    }]);
    expect(versions[0].databases).toBeUndefined();
  });

  it('converts multiple databases in a single version', () => {
    const data = makeData([makeDoc({
      content: {
        versions: [{
          version: 1,
          databases: [
            { databaseName: 'db1', whitelist: [{ name: 'main', type: 'schema' }] },
            { databaseName: 'db2', whitelist: [{ name: 'orders', type: 'table', schema: 'public' }] },
          ],
          docs: [],
        }],
        published: { all: 1 },
      } as any,
    })]);

    const result = migrate(data);
    const wl = getContextVersions(result, '/org/context')![0].whitelist;
    expect(wl).toHaveLength(2);
    expect(wl.map((n: any) => n.name)).toEqual(expect.arrayContaining(['db1', 'db2']));
  });

  it('does not modify a version that already has whitelist (no databases field)', () => {
    const existingWhitelist: Whitelist = [{ name: 'mydb', type: 'connection', children: [{ name: 'public', type: 'schema' }] }];
    const data = makeData([makeDoc({
      content: {
        versions: [{
          version: 1,
          whitelist: existingWhitelist,
          docs: [],
          createdAt: '2024-01-01T00:00:00Z',
          createdBy: 1,
        }],
        published: { all: 1 },
      },
    })]);

    const result = migrate(data);
    const versions = getContextVersions(result, '/org/context')!;
    expect(versions[0].whitelist).toEqual(existingWhitelist);
  });

  it('does not modify non-context documents', () => {
    const questionDoc = makeDoc({
      id: 2, path: '/org/myquestion', type: 'question',
      content: { query: 'SELECT 1', databases: [{ databaseName: 'unused' }] } as any,
    });
    const data = makeData([questionDoc]);

    migrate(data);
    // The databases field on a non-context doc should be untouched
    expect((questionDoc.content as any).databases).toBeDefined();
  });
});

// ─── Part B: default context creation ───────────────────────────────────────

describe('V33 migration — Part B: create default context per folder', () => {
  it('creates a default context for a folder that has none', () => {
    const folderDoc = makeDoc({ id: 10, path: '/org', type: 'folder', name: 'org', content: { description: '' } });
    const data = makeData([folderDoc]);

    const result = migrate(data);
    const contextPaths = getContextPaths(result);
    expect(contextPaths).toContain('/org/context');
  });

  it('does not create a duplicate context if one already exists', () => {
    const folderDoc = makeDoc({ id: 10, path: '/org', type: 'folder', name: 'org', content: { description: '' } });
    const contextDoc = makeDoc({ id: 11, path: '/org/context', type: 'context', name: 'context' });
    const data = makeData([folderDoc, contextDoc]);

    const result = migrate(data);
    const contextPaths = getContextPaths(result);
    expect(contextPaths.filter(p => p === '/org/context')).toHaveLength(1);
  });

  it('creates default contexts for multiple folders', () => {
    const docs = [
      makeDoc({ id: 10, path: '/org', type: 'folder', name: 'org', content: { description: '' } }),
      makeDoc({ id: 11, path: '/org/sales', type: 'folder', name: 'sales', content: { description: '' } }),
      makeDoc({ id: 12, path: '/org/engineering', type: 'folder', name: 'engineering', content: { description: '' } }),
    ];
    const data = makeData(docs);

    const result = migrate(data);
    const contextPaths = getContextPaths(result);
    expect(contextPaths).toContain('/org/context');
    expect(contextPaths).toContain('/org/sales/context');
    expect(contextPaths).toContain('/org/engineering/context');
  });

  it('new default context has whitelist: "*" and published: { all: 1 }', () => {
    const folderDoc = makeDoc({ id: 10, path: '/org', type: 'folder', name: 'org', content: { description: '' } });
    const data = makeData([folderDoc]);

    const result = migrate(data);
    const docs = (result.companies[0] as CompanyData).documents;
    const newContext = docs.find(d => d.path === '/org/context');

    expect(newContext).toBeDefined();
    const content = newContext!.content as any;
    expect(content.versions).toHaveLength(1);
    expect(content.versions[0].whitelist).toBe('*');
    expect(content.published).toEqual({ all: 1 });
  });

  it('assigns unique IDs above existing max ID', () => {
    const docs = [
      makeDoc({ id: 50, path: '/org', type: 'folder', name: 'org', content: { description: '' } }),
      makeDoc({ id: 51, path: '/org/sales', type: 'folder', name: 'sales', content: { description: '' } }),
    ];
    const data = makeData(docs);

    const result = migrate(data);
    const allDocs = (result.companies[0] as CompanyData).documents;
    const newContextIds = allDocs
      .filter(d => d.type === 'context')
      .map(d => d.id);

    // All IDs should be > 51 (the max input ID)
    expect(newContextIds.every(id => id > 51)).toBe(true);
    // All IDs should be unique
    expect(new Set(newContextIds).size).toBe(newContextIds.length);
  });
});

// ─── Combined: both parts in one migration run ───────────────────────────────

describe('V33 migration — combined', () => {
  it('converts existing context and adds default context for folder in one pass', () => {
    const docs = [
      makeDoc({
        id: 1, path: '/org', type: 'folder', name: 'org', content: { description: '' },
      }),
      makeDoc({
        id: 2, path: '/org/context', type: 'context', name: 'context',
        content: {
          versions: [{
            version: 1,
            databases: [{ databaseName: 'mydb', whitelist: [{ name: 'main', type: 'schema' }] }],
            docs: [],
          }],
          published: { all: 1 },
        } as any,
      }),
      makeDoc({
        id: 3, path: '/org/sales', type: 'folder', name: 'sales', content: { description: '' },
      }),
    ];
    const data = makeData(docs);

    const result = migrate(data);
    const allDocs = (result.companies[0] as CompanyData).documents;

    // Part A: existing context converted
    const orgContext = allDocs.find(d => d.path === '/org/context')!;
    const wl = (orgContext.content as any).versions[0].whitelist;
    expect(wl).toEqual([{
      name: 'mydb', type: 'connection',
      children: [{ name: 'main', type: 'schema' }],
    }]);
    expect((orgContext.content as any).versions[0].databases).toBeUndefined();

    // Part B: /org/sales/context created
    const salesContext = allDocs.find(d => d.path === '/org/sales/context');
    expect(salesContext).toBeDefined();
    expect((salesContext!.content as any).versions[0].whitelist).toBe('*');
  });
});
