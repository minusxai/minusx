/**
 * DatasetContainerV2 — the self-serve UI of static-data-as-files.
 * CREATE: New → Dataset renders the upload/link form and posts through the
 * dataset client (validation errors surfaced). VIEW: tables render with
 * per-table expose checkboxes; unchecking persists hiddenTables through the
 * real file-state save path.
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import DatasetContainerV2 from '@/components/containers/DatasetContainerV2';
import * as storeModule from '@/store/store';
import { setFile, selectMergedContent } from '@/store/filesSlice';
import type { DatasetContent } from '@/lib/types/datasets';
import type { DbFile } from '@/lib/types';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('folder=/org/sales'),
}));
vi.mock('@/lib/navigation/NavigationGuardProvider', () => ({
  useNavigationGuard: () => ({ navigate: vi.fn() }),
}));

const CONTENT: DatasetContent = {
  files: [
    { filename: 'deals.csv', table_name: 'deals', schema_name: 'sales', s3_key: 'k1', file_format: 'csv', row_count: 12, columns: [{ name: 'id', type: 'BIGINT' }], source: 'upload' },
    { filename: 'budget', table_name: 'budget', schema_name: 'sales', s3_key: 'k2', file_format: 'csv', row_count: 5, columns: [], source: 'link', source_url: 'https://sheet' },
  ],
};

function seed(store: ReturnType<typeof storeModule.makeStore>, content: DatasetContent) {
  const file: DbFile = {
    id: 42, name: 'pipeline', type: 'dataset', path: '/org/sales/pipeline', content,
    created_at: 'now', updated_at: 'now', version: 1, last_edit_id: null,
  } as unknown as DbFile;
  store.dispatch(setFile({ file, references: [] }));
}

describe('DatasetContainerV2 — create mode', () => {
  it('renders the upload/link form and validates before posting', async () => {
    vi.stubGlobal('fetch', vi.fn());
    renderWithProviders(<DatasetContainerV2 fileId={-1} mode="create" />);
    expect(screen.getByLabelText('Dataset name')).toBeTruthy();
    expect(screen.getByLabelText('Dataset link URL')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Create dataset'));
    expect((await screen.findByLabelText('Dataset error')).textContent).toMatch(/name/i);
    fireEvent.change(screen.getByLabelText('Dataset name'), { target: { value: 'pipeline' } });
    fireEvent.click(screen.getByLabelText('Create dataset'));
    await waitFor(() =>
      expect(screen.getByLabelText('Dataset error').textContent).toMatch(/files|link/i));
    vi.unstubAllGlobals();
  });

  it('a LINK submission posts source_url to /api/datasets', async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, json: async () => ({ success: true, data: { id: 7 } }) } as Response));
    vi.stubGlobal('fetch', fetchSpy);
    renderWithProviders(<DatasetContainerV2 fileId={-1} mode="create" />);
    fireEvent.change(screen.getByLabelText('Dataset name'), { target: { value: 'budget' } });
    fireEvent.change(screen.getByLabelText('Dataset link URL'), { target: { value: 'https://docs.google.com/spreadsheets/d/x' } });
    fireEvent.click(screen.getByLabelText('Create dataset'));
    await waitFor(() => {
      const call = fetchSpy.mock.calls.find((c) => String(c[0]).includes('/api/datasets'));
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body).toMatchObject({ path: '/org/sales', name: 'budget', source_url: 'https://docs.google.com/spreadsheets/d/x' });
    });
    vi.unstubAllGlobals();
  });
});

describe('DatasetContainerV2 — view mode', () => {
  it('lifecycle actions: delete-table and re-import PATCH the dataset endpoint', async () => {
    const testStore = storeModule.makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    seed(testStore, CONTENT);
    const fetchSpy = vi.fn(async (_i: RequestInfo | URL, _o?: RequestInit) =>
      ({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) } as Response));
    vi.stubGlobal('fetch', fetchSpy);

    renderWithProviders(<DatasetContainerV2 fileId={42} />, { store: testStore });
    expect(screen.getByLabelText('Add files to dataset')).toBeTruthy(); // append affordance exists
    // link-sourced table gets a re-import button ONLY when it has a source_group
    expect(screen.queryByLabelText('Re-import sales.budget')).toBeNull();

    fireEvent.click(screen.getByLabelText('Delete table sales.deals'));
    await waitFor(() => {
      const call = fetchSpy.mock.calls.find((c) => String(c[0]).includes('/api/datasets/42'));
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body).toMatchObject({ action: 'delete-table', table: 'sales.deals' });
    });
    vi.unstubAllGlobals();
  });

  it('lists tables with expose checkboxes; unchecking persists hiddenTables', async () => {
    const testStore = storeModule.makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    seed(testStore, CONTENT);
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { file: { id: 42 } } }) } as Response));
    vi.stubGlobal('fetch', fetchSpy);

    renderWithProviders(<DatasetContainerV2 fileId={42} />, { store: testStore });
    const deals = screen.getByLabelText('Expose table sales.deals') as HTMLInputElement;
    expect(deals.checked).toBe(true);
    expect(screen.getByLabelText('Dataset table sales.budget').textContent).toContain('https://sheet');

    fireEvent.click(deals);
    await waitFor(() => {
      const merged = selectMergedContent(testStore.getState(), 42) as DatasetContent;
      expect(merged.hiddenTables ?? []).toContain('sales.deals');
    });
    vi.unstubAllGlobals();
  });
});
