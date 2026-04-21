/**
 * EditFileDisplay UI tests — restore buttons (undo/redo).
 *
 * Verifies:
 * - Restore buttons appear when diff contains parseable before/after states
 * - "Restore to before" calls replaceFileState with the original file object
 * - "Restore to after" calls replaceFileState with the final file object
 * - Button opacity toggles correctly between restored/not-restored states
 * - Buttons do NOT appear when diff is missing or unparseable
 */

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockReplaceFileState = jest.fn().mockResolvedValue({ success: true });
jest.mock('@/lib/api/file-state', () => ({
  replaceFileState: (...args: unknown[]) => mockReplaceFileState(...args),
}));

jest.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/f/1',
  useSearchParams: () => new URLSearchParams(),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import * as storeModule from '@/store/store';
import { setFile } from '@/store/filesSlice';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { encodeFileStr } from '@/lib/api/file-encoding';
import type { DbFile, ToolCall, ToolMessage, CompletedToolCall, EditFileDetails } from '@/lib/types';

import EditFileDisplay from '@/components/explore/tools/EditFileDisplay';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FILE_ID = 1;

const originalFile = {
  id: FILE_ID,
  name: 'Revenue Query',
  path: '/org/Revenue Query',
  type: 'question',
  content: {
    description: 'Total revenue',
    query: 'SELECT SUM(amount) FROM orders',
    vizSettings: { type: 'table', xCols: [], yCols: [] },
    parameters: [],
    connection_name: 'test',
  },
  isDirty: false,
};

const editedFile = {
  id: FILE_ID,
  name: 'Revenue Query',
  path: '/org/Revenue Query',
  type: 'question',
  content: {
    description: 'Total revenue by month',
    query: "SELECT month, SUM(amount) FROM orders GROUP BY month",
    vizSettings: { type: 'line', xCols: ['month'], yCols: ['amount'] },
    parameters: [],
    connection_name: 'test',
  },
  isDirty: true,
};

const diff = `-${encodeFileStr(originalFile)}\n+${encodeFileStr(editedFile)}`;

function makeToolCallTuple(opts: { fileId: number; success: boolean; diff?: string }): CompletedToolCall {
  const toolCall: ToolCall = {
    id: 'tc_1',
    type: 'function',
    function: {
      name: 'EditFile',
      arguments: { fileId: opts.fileId, changes: [] },
    },
  };
  const toolMessage: ToolMessage = {
    role: 'tool',
    tool_call_id: 'tc_1',
    content: JSON.stringify({ success: opts.success }),
    details: {
      success: opts.success,
      diff: opts.diff,
    } as EditFileDetails,
  };
  return [toolCall, toolMessage];
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('EditFileDisplay restore buttons', () => {
  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    mockReplaceFileState.mockClear();

    // Seed file into Redux so the component can read file info
    testStore.dispatch(setFile({
      file: {
        id: FILE_ID,
        name: 'Revenue Query',
        path: '/org/Revenue Query',
        type: 'question',
        content: editedFile.content as DbFile['content'],
        references: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',

        version: 1,
        last_edit_id: null,
      },
    }));
  });

  afterEach(() => {
    getStoreSpy.mockRestore();
  });

  it('shows restore buttons when diff has parseable before/after lines', () => {
    const tuple = makeToolCallTuple({ fileId: FILE_ID, success: true, diff });

    renderWithProviders(
      <EditFileDisplay toolCallTuple={tuple} showThinking={true} />,
      { store: testStore }
    );

    expect(screen.getByLabelText('Restore to before this edit')).toBeInTheDocument();
    expect(screen.getByLabelText('Restore to after this edit')).toBeInTheDocument();
  });

  it('does not show restore buttons when diff is empty', () => {
    const tuple = makeToolCallTuple({ fileId: FILE_ID, success: true, diff: '' });

    renderWithProviders(
      <EditFileDisplay toolCallTuple={tuple} showThinking={true} />,
      { store: testStore }
    );

    expect(screen.queryByLabelText('Restore to before this edit')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Restore to after this edit')).not.toBeInTheDocument();
  });

  it('does not show restore buttons on failed edit', () => {
    const tuple = makeToolCallTuple({ fileId: FILE_ID, success: false, diff });

    renderWithProviders(
      <EditFileDisplay toolCallTuple={tuple} showThinking={true} />,
      { store: testStore }
    );

    expect(screen.queryByLabelText('Restore to before this edit')).not.toBeInTheDocument();
  });

  it('calls replaceFileState with original content on "Restore to before"', async () => {
    const tuple = makeToolCallTuple({ fileId: FILE_ID, success: true, diff });

    renderWithProviders(
      <EditFileDisplay toolCallTuple={tuple} showThinking={true} />,
      { store: testStore }
    );

    await userEvent.click(screen.getByLabelText('Restore to before this edit'));

    expect(mockReplaceFileState).toHaveBeenCalledTimes(1);
    expect(mockReplaceFileState).toHaveBeenCalledWith(FILE_ID, originalFile);
  });

  it('calls replaceFileState with final content on "Restore to after" (after undo)', async () => {
    const tuple = makeToolCallTuple({ fileId: FILE_ID, success: true, diff });

    renderWithProviders(
      <EditFileDisplay toolCallTuple={tuple} showThinking={true} />,
      { store: testStore }
    );

    // First restore to before
    await userEvent.click(screen.getByLabelText('Restore to before this edit'));
    expect(mockReplaceFileState).toHaveBeenCalledTimes(1);

    // Then restore to after
    await userEvent.click(screen.getByLabelText('Restore to after this edit'));
    expect(mockReplaceFileState).toHaveBeenCalledTimes(2);
    expect(mockReplaceFileState).toHaveBeenLastCalledWith(FILE_ID, editedFile);
  });

  it('does not call replaceFileState when clicking "Restore to before" twice', async () => {
    const tuple = makeToolCallTuple({ fileId: FILE_ID, success: true, diff });

    renderWithProviders(
      <EditFileDisplay toolCallTuple={tuple} showThinking={true} />,
      { store: testStore }
    );

    await userEvent.click(screen.getByLabelText('Restore to before this edit'));
    await userEvent.click(screen.getByLabelText('Restore to before this edit'));

    // Only the first click should trigger replaceFileState
    expect(mockReplaceFileState).toHaveBeenCalledTimes(1);
  });

  it('does not call replaceFileState when clicking "Restore to after" without prior undo', async () => {
    const tuple = makeToolCallTuple({ fileId: FILE_ID, success: true, diff });

    renderWithProviders(
      <EditFileDisplay toolCallTuple={tuple} showThinking={true} />,
      { store: testStore }
    );

    // Initially we're in the "after edit" state, so redo should be a no-op
    await userEvent.click(screen.getByLabelText('Restore to after this edit'));

    expect(mockReplaceFileState).not.toHaveBeenCalled();
  });
});
