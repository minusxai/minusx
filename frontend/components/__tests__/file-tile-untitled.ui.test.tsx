// Browse surfaces must never render a nameless file as a blank caption — a grid tile
// collapses to a bare icon, and two untitled files of a type look identical. Both the
// grid tile and the list row fall back to "Untitled <Type> #<id>" (getFileDisplayName).
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import FileGridCard from '@/components/file-browser/FileGridCard';
import FileListRow from '@/components/file-browser/FileListRow';
import type { DbFile } from '@/lib/types';

const file = (overrides: Partial<DbFile> = {}): DbFile => ({
  id: 42,
  name: '',
  path: '/org/untitled',
  type: 'story',
  content: {},
  created_at: '2026-07-25T00:00:00Z',
  updated_at: '2026-07-25T00:00:00Z',
  ...overrides,
} as DbFile);

const shared = {
  selectionMode: false,
  selectedFileIds: new Set<number>(),
  draggedFileId: null,
  dropTargetId: null,
  dashboardsByQuestionId: new Map(),
  contextCountByFolder: new Map(),
  toggleFileSelection: vi.fn(),
  enterSelectionWithFile: vi.fn(),
  handleDragStart: vi.fn(),
  handleDrag: vi.fn(),
  handleDragEnd: vi.fn(),
  handleDragOver: vi.fn(),
  handleDragEnter: vi.fn(),
  handleDragLeave: vi.fn(),
  handleDrop: vi.fn(),
};

describe('untitled files in browse surfaces', () => {
  it('grid tile labels a nameless file "Untitled <Type> #<id>"', () => {
    const { getByLabelText } = renderWithProviders(
      <FileGridCard file={file()} {...shared} />,
    );
    expect(getByLabelText('Untitled Story #42')).toBeInTheDocument();
  });

  it('grid tile keeps the real name when the file has one', () => {
    const { getByLabelText } = renderWithProviders(
      <FileGridCard file={file({ name: 'Q2 Narrative' })} {...shared} />,
    );
    expect(getByLabelText('Q2 Narrative')).toBeInTheDocument();
  });

  it('list row labels a nameless file "Untitled <Type> #<id>"', () => {
    const { getByLabelText } = renderWithProviders(
      <FileListRow file={file({ id: 7, type: 'dashboard' })} sectionKey="dashboard" {...shared} />,
    );
    expect(getByLabelText('Untitled Dashboard #7')).toBeInTheDocument();
  });

  it('uses the file type LABEL, not the raw type key', () => {
    const { getByLabelText } = renderWithProviders(
      <FileGridCard file={file({ id: 9, type: 'context' })} {...shared} />,
    );
    expect(getByLabelText('Untitled Knowledge Base #9')).toBeInTheDocument();
  });
});
