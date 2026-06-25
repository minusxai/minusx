/**
 * RegionCaptureButton — click → drag-select → the region is captured and uploaded (shared path),
 * registered as a pending upload (so the chat shows a processing chip + blocks send) and, once
 * done, added as an image attachment. If the pending upload is cancelled mid-flight, the finished
 * result is discarded. Capture + upload mocked; we assert the real Redux state transitions.
 */
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { makeStore } from '@/store/store';
import * as storeModule from '@/store/store';
import { removePendingUpload } from '@/store/uiSlice';

vi.mock('@/lib/screenshot/capture', () => ({
  captureRegionBlob: vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' })),
}));
vi.mock('@/lib/object-store/client', () => ({
  uploadBlobOrEmbed: vi.fn(async () => 'https://cdn.example/selection.jpg'),
}));
vi.mock('@/components/ui/toaster', () => ({ toaster: { create: vi.fn(() => 'toast-1'), update: vi.fn(), dismiss: vi.fn() } }));

import { captureRegionBlob } from '@/lib/screenshot/capture';
import RegionCaptureButton from '../RegionCaptureButton';

const drag = () => {
  fireEvent.click(screen.getByLabelText('Select a screen region to add as context'));
  return screen.findByLabelText('Select a region to send to the agent').then((overlay) => {
    fireEvent.mouseDown(overlay, { clientX: 20, clientY: 20 });
    fireEvent.mouseMove(overlay, { clientX: 220, clientY: 170 });
    fireEvent.mouseUp(overlay, { clientX: 220, clientY: 170 });
  });
};

describe('RegionCaptureButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (captureRegionBlob as ReturnType<typeof vi.fn>).mockImplementation(async () => new Blob(['x'], { type: 'image/jpeg' }));
  });

  it('captures a dragged region → adds an image attachment, and clears the pending upload', async () => {
    const store = makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
    renderWithProviders(<RegionCaptureButton />, { store });

    await drag();

    await waitFor(() => {
      const atts = store.getState().ui.chatAttachments;
      expect(atts).toHaveLength(1);
      expect(atts[0]).toMatchObject({ type: 'image', content: 'https://cdn.example/selection.jpg' });
    });
    expect(store.getState().ui.pendingUploads).toHaveLength(0);
    expect(captureRegionBlob).toHaveBeenCalledWith(
      { x: 20, y: 20, width: 200, height: 150 },
      expect.objectContaining({ filter: expect.any(Function) }),
    );
  });

  it('shows a pending upload immediately (before the image finishes)', async () => {
    let release!: (b: Blob) => void;
    (captureRegionBlob as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Promise<Blob>((r) => { release = r; }));
    const store = makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
    renderWithProviders(<RegionCaptureButton />, { store });

    await drag();
    await waitFor(() => expect(store.getState().ui.pendingUploads).toHaveLength(1));
    expect(store.getState().ui.chatAttachments).toHaveLength(0); // not attached yet
    release(new Blob(['x'], { type: 'image/jpeg' }));
    await waitFor(() => expect(store.getState().ui.chatAttachments).toHaveLength(1));
  });

  it('discards the finished result if the pending upload was cancelled mid-flight', async () => {
    let release!: (b: Blob) => void;
    (captureRegionBlob as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Promise<Blob>((r) => { release = r; }));
    const store = makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
    renderWithProviders(<RegionCaptureButton />, { store });

    await drag();
    await waitFor(() => expect(store.getState().ui.pendingUploads).toHaveLength(1));
    // cancel
    store.dispatch(removePendingUpload(store.getState().ui.pendingUploads[0].id));
    // now the capture finishes — result must be discarded (no attachment)
    release(new Blob(['x'], { type: 'image/jpeg' }));
    await new Promise((r) => setTimeout(r, 10));
    expect(store.getState().ui.chatAttachments).toHaveLength(0);
    expect(store.getState().ui.pendingUploads).toHaveLength(0);
  });
});
