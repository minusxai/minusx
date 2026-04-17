import { MIGRATIONS } from '../migrations';
import type { InitData, CompanyData, ExportedDocument } from '../import-export';

const migrate = MIGRATIONS.find(m => m.dataVersion === 35)!.dataMigration!;

function makeDoc(overrides: Partial<ExportedDocument> & Pick<ExportedDocument, 'id' | 'path' | 'type'>): ExportedDocument {
  return {
    name: overrides.path.split('/').filter(Boolean).pop()!,
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

function makeData(documents: ExportedDocument[], companyId = 1): InitData {
  const company: CompanyData = {
    id: companyId, name: 'test', display_name: 'Test', subdomain: null,
    created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
    users: [], documents,
  };
  return { companies: [company] } as unknown as InitData;
}

function getDocs(data: InitData, companyIdx = 0): ExportedDocument[] {
  return (data.companies[companyIdx] as CompanyData).documents;
}

function getDoc(data: InitData, path: string, companyIdx = 0): ExportedDocument | undefined {
  return getDocs(data, companyIdx).find(d => d.path === path);
}

describe('V35 migration — create missing /{mode}/database/static connection', () => {
  it('creates static connection when database folder exists but static is missing', () => {
    const data = makeData([
      makeDoc({ id: 1, path: '/org', type: 'folder' }),
      makeDoc({ id: 2, path: '/org/database', type: 'folder' }),
    ]);
    const result = migrate(data);
    const doc = getDoc(result, '/org/database/static');
    expect(doc).toBeDefined();
    expect(doc!.type).toBe('connection');
    expect(doc!.name).toBe('static');
    expect((doc!.content as any).type).toBe('csv');
    expect((doc!.content as any).config.files).toEqual([]);
  });

  it('does not create static connection when it already exists', () => {
    const data = makeData([
      makeDoc({ id: 1, path: '/org', type: 'folder' }),
      makeDoc({ id: 2, path: '/org/database', type: 'folder' }),
      makeDoc({ id: 3, path: '/org/database/static', type: 'connection', content: { type: 'csv', config: { files: [{ s3_key: 'existing' }] } } }),
    ]);
    const result = migrate(data);
    const docs = getDocs(result).filter(d => d.path === '/org/database/static');
    expect(docs).toHaveLength(1);
    expect((docs[0].content as any).config.files).toHaveLength(1); // existing data preserved
  });

  it('does not create static connection when database folder does not exist', () => {
    const data = makeData([
      makeDoc({ id: 1, path: '/tutorial', type: 'folder' }),
      // no /tutorial/database folder
    ]);
    const result = migrate(data);
    expect(getDoc(result, '/tutorial/database/static')).toBeUndefined();
  });

  it('creates static connection for all three modes when all database folders exist', () => {
    const data = makeData([
      makeDoc({ id: 1, path: '/org',                type: 'folder' }),
      makeDoc({ id: 2, path: '/org/database',       type: 'folder' }),
      makeDoc({ id: 3, path: '/tutorial',           type: 'folder' }),
      makeDoc({ id: 4, path: '/tutorial/database',  type: 'folder' }),
      makeDoc({ id: 5, path: '/internals',          type: 'folder' }),
      makeDoc({ id: 6, path: '/internals/database', type: 'folder' }),
    ]);
    const result = migrate(data);
    expect(getDoc(result, '/org/database/static')).toBeDefined();
    expect(getDoc(result, '/tutorial/database/static')).toBeDefined();
    expect(getDoc(result, '/internals/database/static')).toBeDefined();
  });

  it('creates only for modes that have the database folder', () => {
    const data = makeData([
      makeDoc({ id: 1, path: '/org',           type: 'folder' }),
      makeDoc({ id: 2, path: '/org/database',  type: 'folder' }),
      makeDoc({ id: 3, path: '/tutorial',      type: 'folder' }),
      // /tutorial/database folder intentionally absent
    ]);
    const result = migrate(data);
    expect(getDoc(result, '/org/database/static')).toBeDefined();
    expect(getDoc(result, '/tutorial/database/static')).toBeUndefined();
  });

  it('assigns a unique id greater than any existing id', () => {
    const data = makeData([
      makeDoc({ id: 50, path: '/org',           type: 'folder' }),
      makeDoc({ id: 99, path: '/org/database',  type: 'folder' }),
    ]);
    const result = migrate(data);
    const doc = getDoc(result, '/org/database/static');
    expect(doc!.id).toBe(100);
  });

  it('works across multiple companies independently', () => {
    const company1: CompanyData = {
      id: 1, name: 'co1', display_name: 'Co1', subdomain: null,
      created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
      users: [],
      documents: [
        makeDoc({ id: 1, path: '/org', type: 'folder', company_id: 1 }),
        makeDoc({ id: 2, path: '/org/database', type: 'folder', company_id: 1 }),
      ],
    };
    const company2: CompanyData = {
      id: 2, name: 'co2', display_name: 'Co2', subdomain: null,
      created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
      users: [],
      documents: [
        makeDoc({ id: 1, path: '/org', type: 'folder', company_id: 2 }),
        makeDoc({ id: 2, path: '/org/database', type: 'folder', company_id: 2 }),
        makeDoc({ id: 3, path: '/org/database/static', type: 'connection', company_id: 2 }),
      ],
    };
    const data = { companies: [company1, company2] } as unknown as InitData;
    const result = migrate(data);

    // company1 — missing static, should be created
    expect(getDoc(result, '/org/database/static', 0)).toBeDefined();
    // company2 — already had static, no duplicate
    const co2docs = getDocs(result, 1).filter(d => d.path === '/org/database/static');
    expect(co2docs).toHaveLength(1);
  });
});
