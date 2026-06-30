/**
 * Regression: the setup wizard's Save must PRESERVE the metrics and annotations
 * the onboarding agent authored. handleSave rebuilds the context version from
 * scratch; if it only copies `docs`, the agent's structured knowledge (metric
 * definitions, column/table annotations) is silently dropped on "Save & Continue".
 */

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

const { CONTEXT_ID } = vi.hoisted(() => ({ CONTEXT_ID: 9101 }));

vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => ({ contextId: CONTEXT_ID, contextLoading: false }),
}));

const editFileSpy = vi.fn();
const publishFileSpy = vi.fn(async () => ({ id: CONTEXT_ID }));
vi.mock('@/lib/api/file-state', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/file-state')>('@/lib/api/file-state');
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
import type { DbFile, ContextContent, ContextVersion, MetricDef, TableAnnotation } from '@/lib/types';

const now = '2026-01-01T00:00:00Z';

const METRICS: MetricDef[] = [
  { name: 'Revenue', description: 'Completed order total', sql: 'SUM(amount)', connection: 'static', schema: 'new_csv', table: 'sales' },
];
const ANNOTATIONS: TableAnnotation[] = [
  { connection: 'static', schema: 'new_csv', table: 'sales', description: 'One row per sale', columns: [{ name: 'amount', description: 'Net sale amount in USD' }] },
];

function contextDbFile(): DbFile {
  const content = {
    fullDocs: [], fullSchema: [], fullSkills: [], parentSchema: [],
    published: { all: 1 },
    versions: [
      {
        createdAt: now, createdBy: 1, description: 'Default context', version: 1, whitelist: '*',
        docs: [{ content: 'Sales knowledge base.' }],
        metrics: METRICS,
        annotations: ANNOTATIONS,
      },
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

async function savedVersion(): Promise<ContextVersion> {
  await waitFor(() => expect(publishFileSpy).toHaveBeenCalled());
  const saveCall = [...editFileSpy.mock.calls].reverse().find(c => c[0]?.changes?.content?.versions);
  const content = saveCall![0].changes.content as ContextContent;
  const versions = content.versions!;
  return versions[versions.length - 1];
}

describe('Setup wizard — preserves onboarding metrics & annotations on save', () => {
  beforeEach(() => {
    editFileSpy.mockClear();
    publishFileSpy.mockClear();
  });

  function renderWizard() {
    const store = makeStore();
    store.dispatch(setUser({
      userId: 1, email: 'test@example.com', name: 'Test', role: 'admin', home_folder: '/org', mode: 'org',
    } as any));
    store.dispatch(setFile({ file: contextDbFile() }));
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

  it('keeps the metrics and annotations through Save & Continue', async () => {
    renderWizard();
    await userEvent.click(await screen.findByLabelText('Continue to documentation'));
    await userEvent.click(await screen.findByLabelText('Save context and continue'));
    const version = await savedVersion();
    expect(version.metrics).toEqual(METRICS);
    expect(version.annotations).toEqual(ANNOTATIONS);
  });

  it('surfaces a summary chip of the metrics and annotations when knowledge exists', async () => {
    renderWizard();
    await userEvent.click(await screen.findByLabelText('Continue to documentation'));
    const chip = await screen.findByLabelText('Added metrics and annotations summary');
    expect(chip).toHaveTextContent('1 metric');
    // 1 table description + 1 column note = 2 annotations.
    expect(chip).toHaveTextContent('2 annotations');
  });
});
