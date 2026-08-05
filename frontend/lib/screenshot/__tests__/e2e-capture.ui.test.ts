/**
 * The `window` seam a QA run captures through (`lib/screenshot/e2e-capture.ts`).
 *
 * What is pinned here is the contract the out-of-process driver depends on and
 * cannot check for itself: the hook lands on `window` under the shared key, it
 * returns a data: URL (a Blob cannot cross `page.evaluate`), and it forwards to
 * the APP's capture with full height and the page's live color mode — the
 * whole point of the `download` renderer is that it is the product's own image,
 * not a QA lookalike.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// `window.Blob`, not the global: vitest's jsdom environment leaves Node's own
// Blob as the global, and jsdom's FileReader rejects it as "not of type Blob".
const captureFileViewBlob = vi.fn(
  async (_fileId: number, _opts: Record<string, unknown>) => new window.Blob(['png-bytes'], { type: 'image/png' }),
);
vi.mock('../capture', () => ({
  captureFileViewBlob: (id: number, opts: Record<string, unknown>) => captureFileViewBlob(id, opts),
}));

import { installE2eCaptureHook, captureFileForE2e } from '../e2e-capture';
import { E2E_CAPTURE_KEY, DISPLAY_IMAGE_MAX_PX } from '../constants';

describe('e2e capture hook', () => {
  beforeEach(() => {
    captureFileViewBlob.mockClear();
    document.documentElement.classList.remove('dark');
    delete (window as unknown as Record<string, unknown>)[E2E_CAPTURE_KEY];
  });

  it('installs the capture function on window under the shared key', async () => {
    expect((window as unknown as Record<string, unknown>)[E2E_CAPTURE_KEY]).toBeUndefined();
    installE2eCaptureHook();
    const hook = (window as unknown as Record<string, unknown>)[E2E_CAPTURE_KEY];
    expect(typeof hook).toBe('function');
    expect(await (hook as (r: unknown) => Promise<string>)({ fileId: 7 })).toMatch(/^data:image\/png;base64,/);
  });

  it('captures the file view at full height through the app capture path', async () => {
    await captureFileForE2e({ fileId: 42 });
    expect(captureFileViewBlob).toHaveBeenCalledWith(42, expect.objectContaining({
      fullHeight: true,
      format: 'png',
      maxWidth: DISPLAY_IMAGE_MAX_PX,
    }));
  });

  it('follows the page color mode, so a dark document is not composited on white', async () => {
    await captureFileForE2e({ fileId: 1 });
    expect(captureFileViewBlob.mock.calls[0][1]).toMatchObject({ colorMode: 'light' });

    document.documentElement.classList.add('dark');
    await captureFileForE2e({ fileId: 1 });
    expect(captureFileViewBlob.mock.calls[1][1]).toMatchObject({ colorMode: 'dark' });
  });
});
