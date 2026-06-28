// SaveFileModal — "✨ Auto" suggest-a-name from the file being saved.

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

vi.mock('@/lib/api/micro-task', () => ({
  runMicroTaskClient: vi.fn(async () => 'Quarterly Revenue By Region'),
  buildFileMicroInput: vi.fn(() => '{"fileType":"question"}'),
}));
// Content gating is unit-tested separately; here the draft has content.
vi.mock('@/lib/ui/file-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ui/file-utils')>()),
  hasGeneratableContent: () => true,
}));
// Folder list isn't relevant to the suggest behavior.
vi.mock('@/lib/hooks/file-state-hooks', () => ({
  useFilesByCriteria: () => ({ files: [] }),
}));

import SaveFileModal from '@/components/SaveFileModal';
import { runMicroTaskClient, buildFileMicroInput } from '@/lib/api/micro-task';

describe('SaveFileModal suggest name', () => {
  it('suggests a name from the file being saved and fills the input', async () => {
    const { findByLabelText } = renderWithProviders(
      <SaveFileModal isOpen onClose={vi.fn()} fileId={42} fileType="question" onSave={vi.fn()} />,
    );

    fireEvent.click(await findByLabelText('Suggest a name'));

    await waitFor(async () => {
      const input = (await findByLabelText('File name')) as HTMLInputElement;
      expect(input.value).toBe('Quarterly Revenue By Region');
    });
    expect(buildFileMicroInput).toHaveBeenCalledWith(42);
    expect(runMicroTaskClient).toHaveBeenCalledWith(
      'title',
      expect.objectContaining({ subject: 'a question' }),
    );
  });

  it('hides the suggest button once a name is present', async () => {
    const { findByLabelText, queryByLabelText } = renderWithProviders(
      <SaveFileModal isOpen onClose={vi.fn()} fileId={1} fileType="dashboard" onSave={vi.fn()} />,
    );

    expect(await findByLabelText('Suggest a name')).toBeTruthy();
    const input = (await findByLabelText('File name')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'My dashboard' } });
    await waitFor(() => expect(queryByLabelText('Suggest a name')).toBeNull());
  });
});
