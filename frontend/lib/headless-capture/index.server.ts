/**
 * Headless story capture — the public seam (Story_Design_V2 §6c).
 *
 * `renderStoryToImage(input)` → bitmap, behind the `StoryCaptureBackend` interface: callers
 * never know (or import) the backend. Today's backend is Playwright-in-the-same-container
 * (`playwright-backend.server.ts`); a separate capture service later is a transport swap
 * behind this same function.
 *
 * Env contract: `HEADLESS_CAPTURE=1` (or `true`) opts a deployment in; default off. When off,
 * or when Chromium cannot launch, the result is `{ ok: false, reason: 'unavailable' }` and
 * callers degrade gracefully — the capability is strictly additive.
 *
 * Lifecycle (per §6c, owned by CaptureManager): lazy singleton browser launched on the first
 * capture (zero cost if unused), ~60s idle shutdown, concurrency semaphore of 2.
 */
import 'server-only';
import { HEADLESS_CAPTURE } from '@/lib/config';
import { CaptureManager } from './manager';
import { createPlaywrightBackend } from './playwright-backend.server';
import type { StoryCaptureInput, StoryCaptureResult } from './types';

export type { StoryCaptureBackend, StoryCaptureInput, StoryCaptureResult } from './types';

const manager = new CaptureManager({
  isEnabled: () => HEADLESS_CAPTURE,
  createBackend: createPlaywrightBackend,
});

/** Capture a story file as an image. Never throws — see StoryCaptureResult. */
export function renderStoryToImage(input: StoryCaptureInput): Promise<StoryCaptureResult> {
  return manager.render(input);
}

/** Close the shared backend now (tests / graceful process shutdown). */
export function shutdownHeadlessCapture(): Promise<void> {
  return manager.shutdown();
}
