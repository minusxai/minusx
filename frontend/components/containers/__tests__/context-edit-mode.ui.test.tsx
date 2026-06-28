// ContextContainerV2 — edit mode lives in the shared Redux `fileEditMode`
// (not local component state), so the breadcrumb edit banner can read it like
// it does for dashboards and stories.

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { makeStore } from '@/store/store';
import { setFile, setEdit } from '@/store/filesSlice';
import { selectFileEditMode } from '@/store/uiSlice';
import type { DbFile } from '@/lib/types';

// Stub the heavy editor — surface the edit-mode props as aria-labeled buttons.
vi.mock('@/components/context/ContextEditorV2', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ editMode, onCancel, onEditModeChange }: any) =>
      React.createElement('div', {}, [
        React.createElement('span', { key: 'm', 'aria-label': 'edit-mode-value' }, String(editMode)),
        React.createElement('button', { key: 'c', 'aria-label': 'stub-cancel', onClick: onCancel }, 'cancel'),
        React.createElement('button', { key: 'e', 'aria-label': 'stub-enter-edit', onClick: () => onEditModeChange(true) }, 'edit'),
      ]),
  };
});
vi.mock('@/lib/hooks/job-runs-hooks', () => ({
  useJobRuns: () => ({ runs: [], selectedRunId: null, selectedRun: null, isRunning: false, trigger: vi.fn(), selectRun: vi.fn(), reload: vi.fn() }),
}));
vi.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
// Keep file-state network calls inert; useFile reads the seeded store directly.
vi.mock('@/lib/api/file-state', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/file-state')>()),
  loadFiles: vi.fn(async () => {}),
  reloadFile: vi.fn(async () => {}),
  publishFile: vi.fn(async () => ({ id: FILE_ID, name: 'ctx', path: '/org/ctx' })),
  clearFileChanges: vi.fn(),
  editFile: vi.fn(),
}));

import ContextContainerV2 from '@/components/containers/ContextContainerV2';

const FILE_ID = 4242;

function makeContextFile(): DbFile {
  return {
    id: FILE_ID,
    name: 'ctx',
    path: '/org/ctx',
    type: 'context',
    content: {
      versions: [{ version: 1, whitelist: [], docs: [], createdAt: '2024-01-01T00:00:00Z', createdBy: 1, description: '' }],
      published: { all: 1 },
      fullSchema: [],
      fullDocs: [],
    },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  } as unknown as DbFile;
}

function seededStore() {
  const store = makeStore();
  store.dispatch(setFile({ file: makeContextFile() }));
  return store;
}

describe('ContextContainerV2 edit mode → Redux fileEditMode', () => {
  it('create mode enters edit mode in Redux on mount', async () => {
    const store = seededStore();
    renderWithProviders(<ContextContainerV2 fileId={FILE_ID} mode="create" />, { store });
    await waitFor(() => expect(selectFileEditMode(store.getState(), FILE_ID)).toBe(true));
  });

  it('view mode starts not-editing, then auto-enters edit mode when the file becomes dirty', async () => {
    const store = seededStore();
    renderWithProviders(<ContextContainerV2 fileId={FILE_ID} mode="view" />, { store });
    expect(selectFileEditMode(store.getState(), FILE_ID)).toBe(false);

    store.dispatch(setEdit({ fileId: FILE_ID, edits: { fullDocs: [{ content: 'x' }] } as any }));
    await waitFor(() => expect(selectFileEditMode(store.getState(), FILE_ID)).toBe(true));
  });

  it('cancel exits edit mode in Redux', async () => {
    const store = seededStore();
    const { findByLabelText } = renderWithProviders(
      <ContextContainerV2 fileId={FILE_ID} mode="create" />, { store },
    );
    await waitFor(() => expect(selectFileEditMode(store.getState(), FILE_ID)).toBe(true));

    fireEvent.click(await findByLabelText('stub-cancel'));
    await waitFor(() => expect(selectFileEditMode(store.getState(), FILE_ID)).toBe(false));
  });
});
