import React from 'react';
import { screen } from '@testing-library/react';

import * as storeModule from '@/store/store';
import FilesList from '@/components/FilesList';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

function makeQuestion(id: number, name: string) {
  return {
    id,
    name,
    type: 'question' as const,
    path: `/org/${name}`,
    content: { query: 'SELECT 1', vizSettings: { type: 'table' as const }, connection_name: '' },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: new Date().toISOString(),
    references: [] as number[],
    version: 1,
    last_edit_id: null,
  };
}

function makeContext(id: number, name: string) {
  return {
    id,
    name,
    type: 'context' as const,
    path: `/org/${name}`,
    content: {},
    created_at: '2025-01-01T00:00:00Z',
    updated_at: new Date().toISOString(),
    references: [] as number[],
    version: 1,
    last_edit_id: null,
  };
}

describe('FilesList grouping', () => {
  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
  });

  afterEach(() => {
    getStoreSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('hides the section header when all visible files belong to a single group', () => {
    renderWithProviders(
      <FilesList files={[makeQuestion(1010, 'Revenue Report'), makeQuestion(1011, 'Sales Summary')]} showToolbar={false} />,
      { store: testStore }
    );

    expect(screen.queryByLabelText('Questions section')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Revenue Report')).toBeInTheDocument();
    expect(screen.getByLabelText('Sales Summary')).toBeInTheDocument();
  });

  it('keeps the only non-context section expanded when knowledge base is also present', () => {
    renderWithProviders(
      <FilesList files={[makeContext(1030, 'Knowledge Base'), makeQuestion(1010, 'Revenue Report')]} showToolbar={false} />,
      { store: testStore }
    );

    expect(screen.getByLabelText('Questions section')).toBeInTheDocument();
    expect(screen.getByLabelText('Revenue Report')).toBeInTheDocument();
    expect(screen.queryByText(/Show 1 Files/i)).not.toBeInTheDocument();
  });
});
