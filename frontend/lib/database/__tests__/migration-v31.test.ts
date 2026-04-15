import { MIGRATIONS } from '../migrations';
import type { InitData, CompanyData, ExportedDocument } from '../import-export';

const migrate = MIGRATIONS.find(m => m.dataVersion === 31)!.dataMigration!;

function makeData(configContent: Record<string, unknown>): InitData {
  const doc: ExportedDocument = {
    id: 1,
    name: 'config',
    path: '/org/configs/config.json',
    type: 'config',
    content: configContent,
    references: [],
    version: 1,
    last_edit_id: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    company_id: 1,
  };
  const company: CompanyData = {
    id: 1, name: 'test', display_name: 'Test', subdomain: null,
    created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
    users: [], documents: [doc],
  };
  return { companies: [company] } as unknown as InitData;
}

function getCreateTypes(data: InitData): unknown {
  return ((data.companies[0] as CompanyData).documents[0].content as any)?.accessRules?.admin?.createTypes;
}

describe('V31 migration — accessRules.admin.createTypes', () => {
  it('adds conversation and config to an existing createTypes array', () => {
    const data = makeData({ accessRules: { admin: { createTypes: ['question', 'dashboard'] } } });
    const result = migrate(data);
    expect(getCreateTypes(result)).toEqual(expect.arrayContaining(['question', 'dashboard', 'conversation', 'config']));
  });

  it('does not duplicate types already present', () => {
    const data = makeData({ accessRules: { admin: { createTypes: ['conversation', 'config'] } } });
    const result = migrate(data);
    const types = getCreateTypes(result) as string[];
    expect(types.filter(t => t === 'conversation')).toHaveLength(1);
    expect(types.filter(t => t === 'config')).toHaveLength(1);
  });

  it('leaves createTypes: "*" unchanged', () => {
    const data = makeData({ accessRules: { admin: { createTypes: '*' } } });
    const result = migrate(data);
    expect(getCreateTypes(result)).toBe('*');
  });

  it('skips configs with no accessRules.admin.createTypes array', () => {
    const data = makeData({ accessRules: { admin: {} } });
    const result = migrate(data);
    expect(getCreateTypes(result)).toBeUndefined();
  });

  it('skips configs with no accessRules', () => {
    const data = makeData({ branding: { displayName: 'Acme' } });
    const result = migrate(data);
    expect((data.companies[0] as CompanyData).documents[0].content).not.toHaveProperty('accessRules');
  });

  it('ignores non-config documents', () => {
    const doc: ExportedDocument = {
      id: 2, name: 'question', path: '/org/q',
      type: 'question',
      content: { accessRules: { admin: { createTypes: ['question'] } } } as any,
      references: [], version: 1, last_edit_id: null,
      created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
      company_id: 1,
    };
    const company: CompanyData = {
      id: 1, name: 'test', display_name: 'Test', subdomain: null,
      created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
      users: [], documents: [doc],
    };
    const data = { companies: [company] } as unknown as InitData;
    migrate(data);
    expect((doc.content as any).accessRules.admin.createTypes).toEqual(['question']);
  });
});
