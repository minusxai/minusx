/**
 * Expose the browser capture path to an out-of-process Playwright run.
 *
 * The QA report offers two image renderers per row: Playwright's compositor
 * screenshot, and the image the APP itself produces — the serialize-the-live-
 * surface path behind ReviewFile and the dev panel's "Get image". A driver
 * outside the page cannot import a bundled module, so the second one needs a
 * `window` seam. This is that seam, and it is deliberately one function wide:
 * it forwards to `captureFileViewBlob` and adds nothing, so the two renderers
 * really are the same code the product runs and not a QA-only lookalike.
 *
 * Gated exactly like `window.__MX_STORE__` — the build-time E2E flag or the QA
 * runtime opt-in (`?e2e=<secret>`). Read-only: it captures what is on screen
 * and mutates nothing.
 */
import { captureFileViewBlob } from './capture';
import { DISPLAY_IMAGE_MAX_PX, E2E_CAPTURE_KEY } from './constants';

export interface E2eCaptureRequest {
  fileId: number;
  /** Output width cap; defaults to the app's own display-image cap. */
  maxWidth?: number;
}

/** A data: URL — the wire format, because a Blob cannot cross `page.evaluate`. */
export type E2eCaptureFn = (req: E2eCaptureRequest) => Promise<string>;

/**
 * Blob → data: URL. Chunked `String.fromCharCode` rather than one spread: a
 * full-height story capture is megabytes, and a single call with that many
 * arguments overflows the call stack.
 */
async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
}

export async function captureFileForE2e(req: E2eCaptureRequest): Promise<string> {
  // Follow the page's live color mode rather than assuming light: it decides
  // the background the capture is composited onto, and a dark story on a light
  // fill is a different image from the one a reader sees.
  const colorMode = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  const blob = await captureFileViewBlob(req.fileId, {
    colorMode,
    format: 'png',
    fullHeight: true,
    maxWidth: req.maxWidth ?? DISPLAY_IMAGE_MAX_PX,
  });
  return blobToDataUrl(blob);
}

export function installE2eCaptureHook(): void {
  (window as unknown as Record<string, E2eCaptureFn>)[E2E_CAPTURE_KEY] = captureFileForE2e;
}
