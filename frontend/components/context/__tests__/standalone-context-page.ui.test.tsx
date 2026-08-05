import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { makeStore } from '@/store/store';
import { setUser } from '@/store/authSlice';
import { setFile } from '@/store/filesSlice';
import { setEnableCustomAgents } from '@/store/uiSlice';
import type { DbFile } from '@/lib/types';

const contextsState = vi.hoisted(() => ({
  contexts: [] as DbFile[],
  homeContext: undefined as DbFile | undefined,
  loading: false,
  error: null as Error | null,
}));

vi.mock('@/lib/hooks/useContexts', () => ({
  useContexts: () => contextsState,
}));

vi.mock('@/components/containers/ContextContainerV2', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ fileId, standaloneTab }: { fileId: number; standaloneTab: string }) => React.createElement(
      'div',
      { 'data-testid': 'context-surface', 'data-file-id': String(fileId), 'data-surface': standaloneTab },
    ),
  };
});

import StandaloneContextPage from '@/components/context/StandaloneContextPage';

function contextFile(id: number, path: string): DbFile {
  return {
    id,
    name: 'Knowledge Base',
    path,
    type: 'context',
    content: { published: { all: 1 } },
    references: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    version: 1,
    last_edit_id: null,
  } as DbFile;
}

function setup() {
  const store = makeStore();
  store.dispatch(setUser({
    id: 1,
    email: 'viewer@minusx.ai',
    name: 'Viewer',
    role: 'viewer',
    mode: 'org',
  }));
  return store;
}

describe('StandaloneContextPage', () => {
  beforeEach(() => {
    contextsState.contexts = [];
    contextsState.homeContext = undefined;
    contextsState.loading = false;
    contextsState.error = null;
  });

  it('renders the requested context through the standalone Skills component', () => {
    const requested = contextFile(22, '/org/sales/Knowledge Base');
    contextsState.contexts = [requested];

    renderWithProviders(
      <StandaloneContextPage surface="skills" requestedContextId="22" />,
      { store: setup() },
    );

    expect(screen.getByTestId('context-surface')).toHaveAttribute('data-file-id', '22');
    expect(screen.getByTestId('context-surface')).toHaveAttribute('data-surface', 'skills');
  });

  it('falls back to the same nearest home context selector used by chat', () => {
    const store = setup();
    const nearest = contextFile(1008, '/org/Knowledge Base');
    contextsState.contexts = [nearest];
    contextsState.homeContext = nearest;
    store.dispatch(setFile({ file: nearest }));
    store.dispatch(setEnableCustomAgents(true));

    renderWithProviders(<StandaloneContextPage surface="agents" />, { store });

    expect(screen.getByTestId('context-surface')).toHaveAttribute('data-file-id', '1008');
    expect(screen.getByTestId('context-surface')).toHaveAttribute('data-surface', 'agents');
  });

  it('does not substitute another context for an inaccessible requested id', () => {
    const fallback = contextFile(1008, '/org/Knowledge Base');
    contextsState.contexts = [fallback];
    contextsState.homeContext = fallback;

    renderWithProviders(
      <StandaloneContextPage surface="skills" requestedContextId="9999" />,
      { store: setup() },
    );

    expect(screen.queryByTestId('context-surface')).not.toBeInTheDocument();
    expect(screen.getByText('No context is available for this workspace.')).toBeVisible();
  });
});
