// FileTagBadges — renders meta.tags as small labelled badges; nothing when empty.
// Located by aria-label only, per the repo test rules. The FileGridCard case
// closes the plumbing gap: a real DbFile's meta must reach the badge on a tile.
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import FileTagBadges from '@/components/file-browser/FileTagBadges';
import FileGridCard from '@/components/file-browser/FileGridCard';
import FileListRow from '@/components/file-browser/FileListRow';
import { FILE_TAG_LEGACY_STORY } from '@/lib/types/files';
import type { DbFile } from '@/lib/types';

describe('FileTagBadges', () => {
  it('renders a badge per tag, labelled for lookup', () => {
    renderWithProviders(<FileTagBadges meta={{ tags: [FILE_TAG_LEGACY_STORY, 'custom-tag'] }} />);
    expect(screen.getByLabelText(`${FILE_TAG_LEGACY_STORY} tag`)).toBeTruthy();
    expect(screen.getByLabelText('custom-tag tag')).toBeTruthy();
  });

  it('the legacy-story badge shows a human label', () => {
    renderWithProviders(<FileTagBadges meta={{ tags: [FILE_TAG_LEGACY_STORY] }} />);
    expect(screen.getByLabelText(`${FILE_TAG_LEGACY_STORY} tag`).textContent).toMatch(/legacy/i);
  });

  it('a tagged file renders its badge on the FileGridCard tile', () => {
    const file = {
      id: 1, name: 'Old story', path: '/org/old-story', type: 'story',
      content: null, references: [], version: 1, last_edit_id: null,
      created_at: 't', updated_at: 't',
      meta: { tags: [FILE_TAG_LEGACY_STORY] },
    } as unknown as DbFile;
    const noop = () => {};
    renderWithProviders(
      <FileGridCard
        file={file} selectionMode={false} selectedFileIds={new Set()} draggedFileId={null}
        dropTargetId={null} dashboardsByQuestionId={new Map()} contextCountByFolder={new Map()}
        toggleFileSelection={noop} enterSelectionWithFile={noop} handleDragStart={noop}
        handleDrag={noop} handleDragEnd={noop} handleDragOver={noop} handleDragEnter={noop}
        handleDragLeave={noop} handleDrop={noop}
      />,
    );
    expect(screen.getByLabelText(`${FILE_TAG_LEGACY_STORY} tag`).textContent).toMatch(/legacy/i);
  });

  it('a tagged file renders its badge on the FileListRow too (the folder browser list layout)', () => {
    const file = {
      id: 2, name: 'Old story row', path: '/org/old-story-row', type: 'story',
      content: null, references: [], version: 1, last_edit_id: null,
      created_at: 't', updated_at: 't',
      meta: { tags: [FILE_TAG_LEGACY_STORY] },
    } as unknown as DbFile;
    const noop = () => {};
    renderWithProviders(
      <FileListRow
        file={file} sectionKey={'story' as never} selectionMode={false} selectedFileIds={new Set()}
        draggedFileId={null} dropTargetId={null} dashboardsByQuestionId={new Map()}
        contextCountByFolder={new Map()} toggleFileSelection={noop} enterSelectionWithFile={noop}
        handleDragStart={noop} handleDrag={noop} handleDragEnd={noop} handleDragOver={noop}
        handleDragEnter={noop} handleDragLeave={noop} handleDrop={noop}
      />,
    );
    expect(screen.getByLabelText(`${FILE_TAG_LEGACY_STORY} tag`).textContent).toMatch(/legacy/i);
  });

  it('renders nothing for absent or empty tags', () => {
    renderWithProviders(<FileTagBadges meta={null} />);
    expect(screen.queryByLabelText(/ tag$/)).toBeNull();
    renderWithProviders(<FileTagBadges meta={{ tags: [] }} />);
    expect(screen.queryByLabelText(/ tag$/)).toBeNull();
  });
});
