// Folder rows and tiles are draggable so a folder can be dropped into another
// folder (the server moves its context file along with it). Selection mode
// suspends dragging so click-to-select never starts a drag.
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import FileGridCard from '@/components/file-browser/FileGridCard';
import FileListRow from '@/components/file-browser/FileListRow';
import type { DbFile } from '@/lib/types';

const folder = {
  id: 3, name: 'reports', path: '/org/reports', type: 'folder',
  content: null, references: [], version: 1, last_edit_id: null,
  created_at: 't', updated_at: 't', meta: null,
} as unknown as DbFile;

const noop = () => {};

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
