/**
 * FileView centralizes the visual-vs-code decision: when the header's view mode
 * is "Code" (uiSlice fileViewMode === 'json') it renders the shared CodeView
 * (JSON + agent XML); otherwise it renders the type-specific visual component.
 * The type views no longer carry their own JSON branch. All queries by aria-label.
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { setFile } from '@/store/filesSlice';
import { setFileViewMode } from '@/store/uiSlice';

// Isolate FileView's branching from the heavy real containers: the visual path
// renders a known stub instead of QuestionContainerV2.
vi.mock('@/lib/ui/fileComponents', async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  return {
    ...actual,
    hasFileComponent: () => true,
    getFileComponent: () => () =>
      React.createElement('div', { 'aria-label': 'Question visual stub' }),
  };
});

import FileView from '@/components/file-browser/FileView';

const FILE_ID = 7777;

function makeQuestionDbFile() {
  return {
    id: FILE_ID,
    name: 'Revenue',
    type: 'question' as const,
    path: '/org/Revenue',
    content: { query: 'SELECT 1', vizSettings: { type: 'table' as const }, connection_name: '' },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-02T00:00:00Z',
    references: [] as number[],
    version: 1,
    last_edit_id: null,
  };
}

function setup(mode: 'visual' | 'json') {
  const testStore = storeModule.makeStore();
  vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
  testStore.dispatch(setFile({ file: makeQuestionDbFile(), references: [] }));
  testStore.dispatch(setFileViewMode({ fileId: FILE_ID, mode }));
  return testStore;
}

describe('FileView code-mode centralization', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the type-specific visual component when view mode is visual', () => {
    const store = setup('visual');
    renderWithProviders(<FileView fileId={FILE_ID} />, { store });

    expect(screen.getByLabelText('Question visual stub')).toBeInTheDocument();
    // No code surface (no JSON | XML sub-toggle).
    expect(screen.queryByLabelText('JSON editor')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('XML')).not.toBeInTheDocument();
  });

  it('renders the shared CodeView (JSON + XML) when view mode is code', () => {
    const store = setup('json');
    renderWithProviders(<FileView fileId={FILE_ID} />, { store });

    // CodeView's JSON tab is the default; the XML sub-toggle is present.
    expect(screen.getByLabelText('JSON editor')).toBeInTheDocument();
    expect(screen.getByLabelText('XML')).toBeInTheDocument();
    // The type-specific visual component is NOT rendered.
    expect(screen.queryByLabelText('Question visual stub')).not.toBeInTheDocument();
  });
});
