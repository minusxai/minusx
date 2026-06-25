/**
 * RegionCaptureButton — click → drag-select → the captured region is uploaded (shared path)
 * and added as an image attachment (addChatAttachment) so it reaches the agent like any image.
 * Capture + upload are mocked; we assert the real Redux attachment lands in the store.
 */
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { makeStore } from '@/store/store';

vi.mock('@/lib/screenshot/capture', () => ({
  captureRegionBlob: vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' })),
}));
vi.mock('@/lib/object-store/client', () => ({
  uploadBlobOrEmbed: vi.fn(async () => 'https://cdn.example/selection.jpg'),
}));
vi.mock('@/components/ui/toaster', () => ({ toaster: { create: vi.fn(() => 'toast-1'), update: vi.fn(), dismiss: vi.fn() } }));

import { captureRegionBlob } from '@/lib/screenshot/capture';
import RegionCaptureButton from '../RegionCaptureButton';

describe('RegionCaptureButton', () => {
  it('captures a dragged region and adds it as an image attachment to the chat', async () => {
    const store = makeStore();
    renderWithProviders(<RegionCaptureButton />, { store });

    fireEvent.click(screen.getByLabelText('Select a screen region to add as context'));
    const overlay = await screen.findByLabelText('Select a region to send to the agent');
    fireEvent.mouseDown(overlay, { clientX: 20, clientY: 20 });
    fireEvent.mouseMove(overlay, { clientX: 220, clientY: 170 });
    fireEvent.mouseUp(overlay, { clientX: 220, clientY: 170 });

    await waitFor(() => {
      const atts = store.getState().ui.chatAttachments;
      expect(atts).toHaveLength(1);
      expect(atts[0]).toMatchObject({ type: 'image', content: 'https://cdn.example/selection.jpg' });
    });
    // captured the dragged rect, and excludes the overlay from its own screenshot via a filter
    expect(captureRegionBlob).toHaveBeenCalledWith(
      { x: 20, y: 20, width: 200, height: 150 },
      expect.objectContaining({ filter: expect.any(Function) }),
    );
  });

  it('does not add an attachment when the selection is cancelled (Esc)', async () => {
    const store = makeStore();
    renderWithProviders(<RegionCaptureButton />, { store });
    fireEvent.click(screen.getByLabelText('Select a screen region to add as context'));
    await screen.findByLabelText('Select a region to send to the agent');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByLabelText('Select a region to send to the agent')).toBeNull());
    expect(store.getState().ui.chatAttachments).toHaveLength(0);
  });
});
