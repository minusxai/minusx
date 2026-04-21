import { MIGRATIONS } from '../migrations';
import type { InitData, OrgData, ExportedDocument } from '../import-export';

const migrate = MIGRATIONS.find(m => m.dataVersion === 34)!.dataMigration!;

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

    ...overrides,
  };
}

function makeData(documents: ExportedDocument[]): InitData {
  const org: OrgData = {
    id: 1, name: 'test', display_name: 'Test',
    created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
    users: [], documents,
  };
  return { orgs: [org] } as unknown as InitData;
}

function getDocName(data: InitData, path: string): string | undefined {
  return (data.orgs![0] as OrgData).documents.find(d => d.path === path)?.name;
}

describe('V34 migration — rename context files named "context" to "Knowledge Base"', () => {
  it('renames a context file with name "context" to "Knowledge Base"', () => {
    const data = makeData([makeDoc({ name: 'context', path: '/org/context', type: 'context' })]);
    const result = migrate(data);
    expect(getDocName(result, '/org/context')).toBe('Knowledge Base');
  });

  it('does not rename a context file already named "Knowledge Base"', () => {
    const data = makeData([makeDoc({ name: 'Knowledge Base', path: '/org/context', type: 'context' })]);
    const result = migrate(data);
    expect(getDocName(result, '/org/context')).toBe('Knowledge Base');
  });

  it('does not rename a context file with a custom name', () => {
    const data = makeData([makeDoc({ name: 'Analytics Context', path: '/internals/context', type: 'context' })]);
    const result = migrate(data);
    expect(getDocName(result, '/internals/context')).toBe('Analytics Context');
  });

  it('does not rename a non-context file named "context"', () => {
    const data = makeData([makeDoc({ name: 'context', path: '/org/context', type: 'folder' })]);
    const result = migrate(data);
    expect(getDocName(result, '/org/context')).toBe('context');
  });

  it('renames all context files named "context" across multiple documents', () => {
    const data = makeData([
      makeDoc({ id: 1, name: 'context', path: '/org/context',                     type: 'context' }),
      makeDoc({ id: 2, name: 'context', path: '/org/configs/context',              type: 'context' }),
      makeDoc({ id: 3, name: 'context', path: '/org/logs/context',                 type: 'context' }),
      makeDoc({ id: 4, name: 'Knowledge Base', path: '/tutorial/context',          type: 'context' }),
      makeDoc({ id: 5, name: 'Analytics Context', path: '/internals/context',      type: 'context' }),
      makeDoc({ id: 6, name: 'context', path: '/org/folder',                       type: 'folder'  }),
    ]);
    const result = migrate(data);
    expect(getDocName(result, '/org/context')).toBe('Knowledge Base');
    expect(getDocName(result, '/org/configs/context')).toBe('Knowledge Base');
    expect(getDocName(result, '/org/logs/context')).toBe('Knowledge Base');
    expect(getDocName(result, '/tutorial/context')).toBe('Knowledge Base');       // unchanged
    expect(getDocName(result, '/internals/context')).toBe('Analytics Context');   // unchanged
    expect(getDocName(result, '/org/folder')).toBe('context');                    // wrong type, unchanged
  });

  it('renames across multiple orgs', () => {
    const org1: OrgData = {
      id: 1, name: 'co1', display_name: 'Co1',
      created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
      users: [],
      documents: [makeDoc({ id: 1, name: 'context', path: '/org/context', type: 'context' })],
    };
    const org2: OrgData = {
      id: 2, name: 'co2', display_name: 'Co2',
      created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
      users: [],
      documents: [makeDoc({ id: 1, name: 'context', path: '/org/context', type: 'context' })],
    };
    const data = { orgs: [org1, org2] } as unknown as InitData;
    const result = migrate(data);
    expect((result.orgs![0] as OrgData).documents[0].name).toBe('Knowledge Base');
    expect((result.orgs![1] as OrgData).documents[0].name).toBe('Knowledge Base');
  });
});
