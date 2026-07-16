/**
 * RegionCaptureButton — click → drag-select → the region is captured, opened in the ANNOTATOR
 * (brush + undo), and only on confirm uploaded (shared path) + added as an image attachment.
 * A pending upload is registered for the whole capture→annotate→upload window (processing chip,
 * blocks send). Cancelling the pending upload or dismissing the annotator discards the result.
 * Capture + upload mocked; jsdom lacks Image/canvas, so minimal stubs let the real dialog run.
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

// ---- jsdom stubs so the real ImageAnnotatorDialog can load + export an image ----
beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
  // Image that "loads" whatever src it is given
  vi.stubGlobal('Image', class {
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    crossOrigin = '';
    naturalWidth = 100;
    naturalHeight = 60;
    set src(_v: string) { queueMicrotask(() => this.onload?.()); }
  });
  const ctxStub = {
    drawImage: vi.fn(), getImageData: vi.fn(() => ({})), putImageData: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '',
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctxStub) as never;
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) { cb(new Blob(['annotated'], { type: 'image/jpeg' })); };
});

const drag = () => {
  fireEvent.click(screen.getByLabelText('Select a screen region to add as context'));
  return screen.findByLabelText('Select a region to send to the agent').then((overlay) => {
    fireEvent.mouseDown(overlay, { clientX: 20, clientY: 20 });
    fireEvent.mouseMove(overlay, { clientX: 220, clientY: 170 });
    fireEvent.mouseUp(overlay, { clientX: 220, clientY: 170 });
  });
};

const confirmAnnotator = async () => {
  const confirm = await screen.findByLabelText('annotator-confirm');
  await waitFor(() => expect(confirm).not.toBeDisabled());
  fireEvent.click(confirm);
};

describe('RegionCaptureButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (captureRegionBlob as ReturnType<typeof vi.fn>).mockImplementation(async () => new Blob(['x'], { type: 'image/jpeg' }));
  });

  it('captures a dragged region → opens the annotator; confirming attaches + clears pending', async () => {
    const store = makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
    renderWithProviders(<RegionCaptureButton />, { store });

    await drag();

    // annotator opens with the crop; nothing attached yet, pending upload held open
    await screen.findByLabelText('annotator-canvas');
    expect(store.getState().ui.chatAttachments).toHaveLength(0);
    expect(store.getState().ui.pendingUploads).toHaveLength(1);

    await confirmAnnotator();

    await waitFor(() => {
      const atts = store.getState().ui.chatAttachments;
      expect(atts).toHaveLength(1);
      expect(atts[0]).toMatchObject({ type: 'image', content: 'https://cdn.example/selection.jpg' });
    });
    expect(store.getState().ui.pendingUploads).toHaveLength(0);
    expect(captureRegionBlob).toHaveBeenCalledWith(
      { x: 20, y: 20, width: 200, height: 150 },
      // targetBox is snapshotted synchronously at selection time and passed through so the crop
      // frame matches the selection frame (the dev-vs-prod offset fix) — must not be dropped.
      expect.objectContaining({ filter: expect.any(Function), targetBox: expect.objectContaining({ left: expect.any(Number), top: expect.any(Number) }) }),
    );
  });

  it('shows a pending upload immediately (before the capture finishes)', async () => {
    let release!: (b: Blob) => void;
    (captureRegionBlob as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Promise<Blob>((r) => { release = r; }));
    const store = makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
    renderWithProviders(<RegionCaptureButton />, { store });

    await drag();
    await waitFor(() => expect(store.getState().ui.pendingUploads).toHaveLength(1));
    expect(store.getState().ui.chatAttachments).toHaveLength(0); // not attached yet
    release(new Blob(['x'], { type: 'image/jpeg' }));
    await confirmAnnotator();
    await waitFor(() => expect(store.getState().ui.chatAttachments).toHaveLength(1));
  });

  it('discards the finished result if the pending upload was cancelled mid-flight', async () => {
    const store = makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
    renderWithProviders(<RegionCaptureButton />, { store });

    await drag();
    await waitFor(() => expect(store.getState().ui.pendingUploads).toHaveLength(1));
    // cancel while the annotator is open
    store.dispatch(removePendingUpload(store.getState().ui.pendingUploads[0].id));
    await confirmAnnotator();
    await new Promise((r) => setTimeout(r, 10));
    expect(store.getState().ui.chatAttachments).toHaveLength(0);
    expect(store.getState().ui.pendingUploads).toHaveLength(0);
  });

  it('dismissing the annotator discards the crop and clears the pending upload', async () => {
    const store = makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
    renderWithProviders(<RegionCaptureButton />, { store });

    await drag();
    await screen.findByLabelText('annotator-canvas');
    fireEvent.click(await screen.findByLabelText('annotator-cancel'));
    await waitFor(() => expect(store.getState().ui.pendingUploads).toHaveLength(0));
    expect(store.getState().ui.chatAttachments).toHaveLength(0);
  });
});
