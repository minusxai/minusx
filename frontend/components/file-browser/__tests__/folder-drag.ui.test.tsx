// Folder rows and tiles are draggable so a folder can be dropped into another
// folder (the server moves its context file along with it). Selection mode
// suspends dragging so click-to-select never starts a drag.
//
// The full-component tests drive FilesList's REAL drag handlers: the
// affordance tests alone once passed while `handleDragStart` still refused
// folders, so a drag that looked available did nothing.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import FileGridCard from '@/components/file-browser/FileGridCard';
import FileListRow from '@/components/file-browser/FileListRow';
import FilesList from '@/components/file-browser/FilesList';
import { moveFile } from '@/lib/file-state/file-state';
import type { DbFile } from '@/lib/types';

vi.mock('@/lib/file-state/file-state', () => ({
  moveFile: vi.fn().mockResolvedValue(undefined),
  deleteFile: vi.fn(),
  duplicateFile: vi.fn(),
}));

const folder = {
  id: 3, name: 'reports', path: '/org/reports', type: 'folder',
  content: null, references: [], version: 1, last_edit_id: null,
  created_at: 't', updated_at: 't', meta: null,
} as unknown as DbFile;

const noop = () => {};

/** jsdom has no DataTransfer; a store-backed stub covers what the handlers use. */
function makeDataTransfer() {
  const data: Record<string, string> = {};
  return {
    effectAllowed: '', dropEffect: '',
    setData: (k: string, v: string) => { data[k] = v; },
    getData: (k: string) => data[k] ?? '',
    setDragImage: () => {},
  };
}

beforeEach(() => {
  vi.mocked(moveFile).mockClear();
});

const handlers = {
  toggleFileSelection: noop, enterSelectionWithFile: noop, handleDragStart: noop,
  handleDrag: noop, handleDragEnd: noop, handleDragOver: noop, handleDragEnter: noop,
  handleDragLeave: noop, handleDrop: noop,
};

describe('folder drag affordance', () => {
  it('a folder list row is draggable', () => {
    renderWithProviders(
      <FileListRow
        file={folder} sectionKey={'folder' as never} selectionMode={false}
        selectedFileIds={new Set()} draggedFileId={null} dropTargetId={null}
        dashboardsByQuestionId={new Map()} contextCountByFolder={new Map()}
        {...handlers}
      />,
    );
    expect(screen.getByLabelText('reports').closest('a')!.getAttribute('draggable')).toBe('true');
  });

  it('a folder grid tile is draggable', () => {
    renderWithProviders(
      <FileGridCard
        file={folder} selectionMode={false} selectedFileIds={new Set()}
        draggedFileId={null} dropTargetId={null} dashboardsByQuestionId={new Map()}
        contextCountByFolder={new Map()}
        {...handlers}
      />,
    );
    expect(screen.getByLabelText('reports').closest('a')!.getAttribute('draggable')).toBe('true');
  });

  it('selection mode suspends dragging', () => {
    renderWithProviders(
      <FileListRow
        file={folder} sectionKey={'folder' as never} selectionMode={true}
        selectedFileIds={new Set()} draggedFileId={null} dropTargetId={null}
        dashboardsByQuestionId={new Map()} contextCountByFolder={new Map()}
        {...handlers}
      />,
    );
    expect(screen.getByLabelText('reports').closest('a')!.getAttribute('draggable')).toBe('false');
  });

  it('dragging a folder onto another folder moves it there', async () => {
    const archive = {
      ...folder, id: 5, name: 'archive', path: '/org/archive',
    } as unknown as DbFile;
    renderWithProviders(<FilesList files={[folder, archive]} showToolbar={false} />);

    const dt = makeDataTransfer();
    fireEvent.dragStart(screen.getByLabelText('reports').closest('a')!, { dataTransfer: dt });
    fireEvent.drop(screen.getByLabelText('archive').closest('a')!, { dataTransfer: dt });

    await waitFor(() =>
      expect(moveFile).toHaveBeenCalledWith(3, 'reports', '/org/archive/reports'),
    );
  });

  it('a folder dropped into its own subtree is refused client-side', async () => {
    const inner = {
      ...folder, id: 6, name: 'inner', path: '/org/reports/inner',
    } as unknown as DbFile;
    renderWithProviders(<FilesList files={[folder, inner]} showToolbar={false} />);

    const dt = makeDataTransfer();
    fireEvent.dragStart(screen.getByLabelText('reports').closest('a')!, { dataTransfer: dt });
    fireEvent.drop(screen.getByLabelText('inner').closest('a')!, { dataTransfer: dt });

    await waitFor(() => expect(dt.getData('fileId')).toBe('3'));
    expect(moveFile).not.toHaveBeenCalled();
  });

  it('a non-folder file row stays draggable', () => {
    const question = { ...folder, id: 4, name: 'revenue', path: '/org/revenue', type: 'question' } as unknown as DbFile;
    renderWithProviders(
      <FileListRow
        file={question} sectionKey={'question' as never} selectionMode={false}
        selectedFileIds={new Set()} draggedFileId={null} dropTargetId={null}
        dashboardsByQuestionId={new Map()} contextCountByFolder={new Map()}
        {...handlers}
      />,
    );
    expect(screen.getByLabelText('revenue').closest('a')!.getAttribute('draggable')).toBe('true');
  });
});
