/**
 * ContextEditorV2 docs @ mentions — the mention typeahead must offer ONLY what
 * this context actually exposes (fullSchema, whitelist applied), never the
 * parent's available-to-whitelist menu (parentSchema). A non-whitelisted table
 * must never flow into mentions.
 */

import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import type { ContextContent } from '@/lib/types';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('tab=docs'),
}));
vi.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => ({
    contextId: undefined,
    databases: [],
    skills: [],
    availableSkills: [],
    hasContext: false,
    contextLoading: false,
  }),
}));
vi.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: () => null,
}));
// DocumentHeader pulls user data over fetch, which jsdom can't resolve here.
vi.mock('@/lib/hooks/useUsers', () => ({
  useUsers: () => ({ users: [], loading: false }),
  loadUsers: vi.fn(async () => []),
  setUsersInStore: vi.fn(),
}));
// Capture the mentions config handed to the docs editor.
vi.mock('@/components/context/ContextDocsEditor', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ mentions }: { mentions?: unknown }) =>
      React.createElement('div', { 'aria-label': 'captured-mentions' }, JSON.stringify(mentions ?? null)),
  };
});

import ContextEditorV2 from '@/components/context/ContextEditorV2';

/** What this context actually exposes (whitelist applied by the loader). */
const FULL_SCHEMA = [
  {
    databaseName: 'mxbi',
    schemas: [
      { schema: 'V3analytics', tables: [{ table: 'users', columns: [{ name: 'id', type: 'integer' }] }] },
    ],
  },
];

/** What the parent offers to whitelist — a SUPERSET including non-whitelisted tables. */
const PARENT_SCHEMA = [
  {
    databaseName: 'mxbi',
    schemas: [
      { schema: 'V3analytics', tables: [{ table: 'users', columns: [{ name: 'id', type: 'integer' }] }] },
      { schema: 'V2public', tables: [{ table: 'assets', columns: [] }] },
    ],
  },
];

const CONTENT = {
  versions: [{ version: 1, whitelist: [], docs: [{ content: 'hello' }], createdAt: '2024-01-01T00:00:00Z', createdBy: 1 }],
  published: { all: 1 },
  fullSchema: FULL_SCHEMA,
  parentSchema: PARENT_SCHEMA,
  docs: [{ content: 'hello' }],
  fullDocs: [],
} as unknown as ContextContent;

function mount() {
  renderWithProviders(
    <ContextEditorV2
      content={CONTENT}
      fileName="Knowledge Base"
      isDirty={false}
      isSaving={false}
      editMode
      onChange={() => {}}
      onMetadataChange={() => {}}
      onSave={async () => {}}
      onCancel={() => {}}
      onEditModeChange={() => {}}
      file={{ id: 1, path: '/org/context.json', type: 'context' }}
    />,
  );
}

describe('ContextEditorV2 docs mentions whitelisting', () => {
  it('passes only the whitelisted (fullSchema) tables to the docs @ mentions', async () => {
    mount();
    const captured = await screen.findByLabelText('captured-mentions');
    const mentions = JSON.parse(captured.textContent || 'null');

    expect(mentions).not.toBeNull();
    // Whitelisted table flows through…
    expect(JSON.stringify(mentions.whitelistedSchemas)).toContain('users');
    // …but nothing outside the whitelist ever does.
    expect(JSON.stringify(mentions.whitelistedSchemas)).not.toContain('V2public');
    expect(JSON.stringify(mentions.whitelistedSchemas)).not.toContain('assets');
  });
});
