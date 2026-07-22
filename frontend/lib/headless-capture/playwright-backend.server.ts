/**
 * Playwright backend for headless story capture (Story_Design_V2 §6c).
 *
 * Spawns headless Chromium from Node in the same container, loads the story page (`/f/[id]`)
 * exactly as a browser user would — same route, same iframe, same `svg[data-mx-story-svg]`
 * surface — waits for the surface + fonts, and screenshots the story `<svg>` element.
 *
 * Capture mechanism: `locator.screenshot()` clipped to the story SVG element (the pragmatic
 * fallback §6c allows) rather than invoking the client's `serializeStorySvg` in-page — the app
 * bundle doesn't expose the serialize functions on `window`. Parity with the client serialize
 * path is enforced by the fidelity runner (`scripts/headless-capture-fidelity.ts`), which
 * captures the same fixture through BOTH paths and pixel-diffs them under an explicit threshold.
 *
 * Lifecycle (lazy launch, idle shutdown, concurrency) is owned by CaptureManager — this module
 * only knows how to launch, capture, and close. A launch failure (Chromium not installed)
 * propagates and is mapped to `{ ok: false, reason: 'unavailable' }` by the manager.
 */
import 'server-only';
import { chromium, type Browser } from 'playwright-core';
import { STORY_SVG_ATTR, STORY_CANVAS_WIDTH } from '@/lib/story-surface';
import { mintSessionCookie } from './session-cookie.server';
import type { StoryCaptureBackend, StoryCaptureInput } from './types';

/**
 * Render at the READER's canvas width, not a smaller "thumbnail" viewport: since the svg surface
 * tracks its container, the viewport is a LAYOUT input, and a narrower one collapses the story's
 * container-query bands so the agent would review a layout no reader sees.
 */
export const DEFAULT_CAPTURE_WIDTH = STORY_CANVAS_WIDTH;
const VIEWPORT_HEIGHT = 900;
const NAVIGATION_TIMEOUT_MS = 30_000;
const STORY_READY_TIMEOUT_MS = 30_000;
/** Small settle after fonts.ready for chart embeds to paint their final frame. */
const SETTLE_MS = 300;
const JPEG_QUALITY = 85;

export async function createPlaywrightBackend(): Promise<StoryCaptureBackend> {
  const browser: Browser = await chromium.launch({ headless: true });
  return {
    async capture(input: StoryCaptureInput): Promise<{ buffer: Buffer; mime: string }> {
      const width = input.width ?? DEFAULT_CAPTURE_WIDTH;
      const format = input.format ?? 'jpeg';
      const context = await browser.newContext({
        viewport: { width, height: VIEWPORT_HEIGHT },
        deviceScaleFactor: 1,
      });
      try {
        if (input.userEmail) {
          const cookie = await mintSessionCookie(input.userEmail, input.baseUrl);
          if (cookie) {
            await context.addCookies([{ name: cookie.name, value: cookie.value, url: input.baseUrl }]);
          }
        }
        const page = await context.newPage();
        const base = input.baseUrl.replace(/\/+$/, '');
        await page.goto(`${base}/f/${input.fileId}`, {
          waitUntil: 'domcontentloaded',
          timeout: NAVIGATION_TIMEOUT_MS,
        });
        // The story renders inside the same-origin surface iframe under the standard
        // `[data-file-id]` FileView capture node (components/views/story/StoryView.tsx).
        const story = page
          .frameLocator(`[data-file-id="${input.fileId}"] iframe`)
          .locator(`svg[${STORY_SVG_ATTR}]`);
        await story.waitFor({ state: 'visible', timeout: STORY_READY_TIMEOUT_MS });
        // Same readiness rule as the client pipeline (§4): await fonts before rasterizing.
        await story.evaluate((el) => (el.ownerDocument as Document).fonts?.ready);
        await page.waitForTimeout(SETTLE_MS);
        const buffer = await story.screenshot(
          format === 'jpeg' ? { type: 'jpeg', quality: JPEG_QUALITY } : { type: 'png' },
        );
        return { buffer, mime: format === 'jpeg' ? 'image/jpeg' : 'image/png' };
      } finally {
        await context.close();
      }
    },
    async close(): Promise<void> {
      await browser.close();
    },
  };
}
