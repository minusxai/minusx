/**
 * FileActionMenu — Rename. A rename is a move within the same parent (the same
 * server path folder moves take, so context childPaths grants follow the
 * folder). The menu offers it wherever Move is offered.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import FileActionMenu from '@/components/file-browser/FileActionMenu';

const { mockMoveFile } = vi.hoisted(() => ({ mockMoveFile: vi.fn() }));
vi.mock('@/lib/file-state/file-state', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  moveFile: mockMoveFile,
}));

function renderMenu() {
  renderWithProviders(
    <FileActionMenu fileId={7} fileName="reports" filePath="/org/reports" fileType="folder" />
  );
}

async function openRenameDialog() {
  fireEvent.click(screen.getByLabelText('More actions'));
  fireEvent.click(await screen.findByLabelText('Rename'));
  return screen.findByLabelText('New name');
}

describe('FileActionMenu — rename', () => {
  beforeEach(() => mockMoveFile.mockReset());

  it('renames via a move within the same parent folder', async () => {
    renderMenu();
    const input = await openRenameDialog();
    expect((input as HTMLInputElement).value).toBe('reports');
    fireEvent.change(input, { target: { value: 'reports-2026' } });
    fireEvent.click(screen.getByLabelText('Confirm rename'));
    await waitFor(() =>
      expect(mockMoveFile).toHaveBeenCalledWith(7, 'reports-2026', '/org/reports-2026'));
  });

  it('an unchanged or empty name cannot be submitted', async () => {
    renderMenu();
    const input = await openRenameDialog();
    expect(screen.getByLabelText('Confirm rename')).toBeDisabled();
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByLabelText('Confirm rename')).toBeDisabled();
    expect(mockMoveFile).not.toHaveBeenCalled();
  });

  it('a name containing a path separator is refused', async () => {
    renderMenu();
    const input = await openRenameDialog();
    fireEvent.change(input, { target: { value: 'a/b' } });
    expect(screen.getByLabelText('Confirm rename')).toBeDisabled();
  });
});
