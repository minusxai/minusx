/**
 * SaveFileModal — a failed save must keep the dialog OPEN with an inline error
 * under the Name field, because the fix (a different name or folder) lives in
 * this dialog. A publish-path collision is rewritten into the user's own
 * vocabulary: the name they typed and the folder they picked, never "path".
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import SaveFileModal from '@/components/modals/SaveFileModal';
import { UserFacingError, PUBLISHED_PATH_CONFLICT_MESSAGE } from '@/lib/errors';

vi.mock('@/lib/hooks/file-state-hooks', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useFilesByCriteria: () => ({ files: [], loading: false }),
}));

function renderModal(onSave: (name: string, path: string) => Promise<void>) {
  const onClose = vi.fn();
  renderWithProviders(
    <SaveFileModal
      isOpen={true}
      onClose={onClose}
      fileId={42}
      fileType="question"
      onSave={onSave}
    />
  );
  return onClose;
}

async function typeNameAndSave(name: string) {
  fireEvent.change(screen.getByLabelText('File name'), { target: { value: name } });
  fireEvent.click(screen.getByLabelText('Confirm save'));
}

describe('SaveFileModal — conflict recovery', () => {
  it('stays open on a path conflict and explains it with the chosen name, not "path"', async () => {
    const onSave = vi.fn().mockRejectedValue(new UserFacingError(PUBLISHED_PATH_CONFLICT_MESSAGE));
    const onClose = renderModal(onSave);

    await typeNameAndSave('Monthly Revenue Trend');

    const error = await screen.findByLabelText('Save error');
    expect(error.textContent).toContain('"Monthly Revenue Trend"');
    expect(error.textContent).toMatch(/already exists/i);
    expect(error.textContent).toMatch(/different name/i);
    expect(error.textContent).not.toMatch(/path/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows other user-facing errors verbatim, still without closing', async () => {
    const onSave = vi.fn().mockRejectedValue(new UserFacingError('Query validation failed: bad SQL'));
    const onClose = renderModal(onSave);

    await typeNameAndSave('Some Name');

    const error = await screen.findByLabelText('Save error');
    expect(error.textContent).toContain('Query validation failed: bad SQL');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a retry after a conflict clears the error; closing on success is the PARENT\'s move', async () => {
    const onSave = vi.fn()
      .mockRejectedValueOnce(new UserFacingError(PUBLISHED_PATH_CONFLICT_MESSAGE))
      .mockResolvedValueOnce(undefined);
    const onClose = renderModal(onSave);

    await typeNameAndSave('Taken Name');
    await screen.findByLabelText('Save error');

    fireEvent.change(screen.getByLabelText('File name'), { target: { value: 'Fresh Name' } });
    fireEvent.click(screen.getByLabelText('Confirm save'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByLabelText('Save error')).toBeNull());
    // The dialog never closes itself on success — the caller advances the Save
    // All walk or closes; a self-close would race that (see onSave's contract).
    expect(onClose).not.toHaveBeenCalled();
  });
});
