// PublishModal "Save All": when every dirty file is a draft, one click must walk
// a SaveFileModal for EACH draft and save them all (the bug saved only the first).
// jsdom component test, aria-label queries only.

import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { makeStore } from '@/store/store';
import { setFile, setEdit, clearEdits, selectDirtyFiles } from '@/store/filesSlice';
import PublishModal from '@/components/PublishModal';

// editFile is a no-op spy; publishAll's implementation is wired per-test (below)
// so it can clean the saved files out of the real Redux dirty list.
const mocks = vi.hoisted(() => ({
  publishAll: vi.fn(),
  editFile: vi.fn(async () => {}),
  discardAll: vi.fn(),
}));

vi.mock('@/lib/file-state/file-state', () => ({
  publishAll: mocks.publishAll,
  editFile: mocks.editFile,
  discardAll: mocks.discardAll,
}));

// Keep the real useDirtyFiles (a Redux selector) so saves re-render the modal;
// only stub the folder query the SaveFileModal uses (tree collapses to Home).
vi.mock('@/lib/hooks/file-state-hooks', async (orig) => ({
  ...(await orig() as Record<string, unknown>),
  useFilesByCriteria: () => ({ files: [], loading: false }),
}));

// The preview pane mounts a full FileView — stub it; this test is about Save All.
// (Stubbing FileView also cuts the heavy file-component tree that causes the
// global ui-setup to stub PublishModal itself — which we override below.)
vi.mock('@/components/FileView', () => ({ default: () => <div /> }));

// The shared ui setup stubs PublishModal (it transitively imports the whole
// file-component tree). Override that here to exercise the REAL component — the
// FileView stub above keeps the import graph light.
vi.mock('@/components/PublishModal', async (importActual) => {
  const actual = await importActual<typeof import('@/components/PublishModal')>();
  return { __esModule: true, default: actual.default };
});

function draftFile(id: number, name: string) {
  return {
    id,
    name,
    type: 'question' as const,
    path: '',
    content: { query: 'SELECT 1', vizSettings: { type: 'table' as const }, connection_name: '' },
    references: [] as number[],
    version: 1,
    last_edit_id: null,
    draft: true,
  };
}

describe('PublishModal — Save All walks every draft', () => {
  beforeEach(() => {
    mocks.publishAll.mockReset();
    mocks.editFile.mockClear();
    mocks.discardAll.mockClear();
  });

  it('saves ALL draft files from one Save All click (not just the first)', async () => {
    const drafts = [
      draftFile(101, 'Revenue vs Plan'),
      draftFile(102, 'Cash Balance Trend'),
      draftFile(103, 'Net Burn Trend'),
    ];

    const store = makeStore();
    drafts.forEach(d => {
      store.dispatch(setFile({ file: d as never }));
      store.dispatch(setEdit({ fileId: d.id, edits: { description: 'pending' } }));
    });

    // publishAll(ids) cleans those files out of the dirty list — exactly what the
    // real implementation's Redux update does, so useDirtyFiles re-renders.
    mocks.publishAll.mockImplementation(async (ids?: number[]) => {
      const targets = ids ?? selectDirtyFiles(store.getState()).map(f => f.id);
      targets.forEach(id => store.dispatch(clearEdits(id)));
      return {};
    });

    // Sanity: three dirty drafts to start.
    expect(selectDirtyFiles(store.getState())).toHaveLength(3);

    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<PublishModal isOpen onClose={onClose} />, { store });

    // One "Save All" click...
    await user.click(await screen.findByLabelText('Save all'));

    // ...should present a SaveFileModal for EACH draft in turn. The name is
    // pre-filled, so confirm each via Enter on the name field (the Save button
    // lives in a Dialog.Footer that jsdom doesn't mount; Enter is equivalent).
    for (let i = 0; i < drafts.length; i++) {
      const nameInput = await screen.findByLabelText('File name');
      await user.click(nameInput);
      await user.keyboard('{Enter}');
      await waitFor(() => expect(mocks.publishAll.mock.calls.length).toBeGreaterThanOrEqual(i + 1));
    }

    // Every draft got named + published (the bug only ever did the first).
    await waitFor(() => {
      expect(mocks.editFile).toHaveBeenCalledTimes(3);
      const publishedIds = mocks.publishAll.mock.calls.flatMap(c => c[0] ?? []);
      expect(publishedIds).toEqual(expect.arrayContaining([101, 102, 103]));
    });

    // Nothing left unsaved, and the modal auto-closes.
    await waitFor(() => expect(selectDirtyFiles(store.getState())).toHaveLength(0));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
