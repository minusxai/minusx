/**
 * Regression: adding a dataset in the setup wizard must MERGE into the context
 * whitelist, not overwrite it. Overwriting narrowed access and broke dashboards
 * on other connections/schemas for everyone in the workspace.
 */

const { CONTEXT_ID } = vi.hoisted(() => ({ CONTEXT_ID: 9001 }));

vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => ({ contextId: CONTEXT_ID, contextLoading: false }),
}));

// Capture what handleSave writes, and stub publish so onComplete fires.
const editFileSpy = vi.fn();
const publishFileSpy = vi.fn(async () => ({ id: CONTEXT_ID }));
vi.mock('@/lib/file-state/file-state', async () => {
  const actual = await vi.importActual<typeof import('@/lib/file-state/file-state')>('@/lib/file-state/file-state');
  return {
    ...actual,
    loadFiles: vi.fn(async () => []),
    editFile: (arg: any) => editFileSpy(arg),
    publishFile: () => publishFileSpy(),
  };
});

vi.mock('@/components/explore/ChatInterface', () => {
  const React = require('react');
  return { __esModule: true, default: () => React.createElement('div', { 'aria-label': 'chat interface' }) };
});

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeStore } from '@/store/store';
import { setUser } from '@/store/authSlice';
import { setFile } from '@/store/filesSlice';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import StepContext from '@/components/connection-wizard/steps/StepContext';
import type { DbFile, ContextContent, Whitelist } from '@/lib/types';

const now = '2026-01-01T00:00:00Z';

function contextDbFile(whitelist: Whitelist): DbFile {
  const content = {
    fullDocs: [], fullSchema: [], fullSkills: [], parentSchema: [],
    published: { all: 1 },
    versions: [
      { createdAt: now, createdBy: 1, description: 'Default context', docs: [], version: 1, whitelist },
    ],
  } as unknown as ContextContent;
  return {
    id: CONTEXT_ID, name: 'Knowledge Base', path: '/org/context', type: 'context',
    references: [], version: 1, last_edit_id: null, created_at: now, updated_at: now, content,
  } as unknown as DbFile;
}

const STATIC_CONNECTION = {
  metadata: { name: 'static', type: 'csv' as const, config: {}, created_at: now, updated_at: now },
  schema: { schemas: [{ schema: 'new_csv', tables: [{ table: 'sales', columns: [{ name: 'amount', type: 'number' }] }] }] },
} as any;

async function savedWhitelist(): Promise<Whitelist> {
  await waitFor(() => expect(publishFileSpy).toHaveBeenCalled());
  const saveCall = [...editFileSpy.mock.calls].reverse().find(c => c[0]?.changes?.content?.versions);
  const content = saveCall![0].changes.content as ContextContent;
  const versions = content.versions!;
  return versions[versions.length - 1].whitelist;
}

describe('Setup wizard — context whitelist merge', () => {
  beforeEach(() => {
    editFileSpy.mockClear();
    publishFileSpy.mockClear();
  });

  function renderWith(whitelist: Whitelist) {
    const store = makeStore();
    store.dispatch(setUser({
      userId: 1, email: 'test@example.com', name: 'Test', role: 'admin', home_folder: '/org', mode: 'org',
    } as any));
    store.dispatch(setFile({ file: contextDbFile(whitelist) }));
    renderWithProviders(
      <StepContext
        connectionName="static"
        connectionId={42}
        onComplete={() => {}}
        staticSchemas={['new_csv']}
        connections={{ static: STATIC_CONNECTION }}
      />,
      { store },
    );
  }

  it("keeps '*' when the existing whitelist already exposes everything", async () => {
    renderWith('*');
    await userEvent.click(await screen.findByLabelText('Continue to documentation'));
    await userEvent.click(await screen.findByLabelText('Save context and continue'));
    expect(await savedWhitelist()).toBe('*');
  });

  it('preserves an existing connection node and adds the new dataset', async () => {
    renderWith([{ name: 'warehouse', type: 'connection', children: [{ name: 'analytics', type: 'schema' }] }]);
    await userEvent.click(await screen.findByLabelText('Continue to documentation'));
    await userEvent.click(await screen.findByLabelText('Save context and continue'));
    const wl = await savedWhitelist();
    expect(wl).toEqual([
      { name: 'warehouse', type: 'connection', children: [{ name: 'analytics', type: 'schema' }] },
      { name: 'static', type: 'connection', children: [{ name: 'new_csv', type: 'schema' }] },
    ]);
  });
});
