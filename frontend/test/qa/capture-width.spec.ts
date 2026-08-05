/**
 * The capture matrix produces images AT DEVICE WIDTH — the regression guard for
 * the bug that made the first version of this feature useless.
 *
 * A "laptop" image is only evidence of what a laptop reader sees if the
 * document was laid out at laptop width. Captured inside the app shell it was
 * not: the rails and the (open) side chat left a story 708px of a 1280px
 * window, so the report showed a single-column collapse of a four-across
 * layout — and nothing failed, because an image row asserts nothing about its
 * own pixels. The app renderer then upscaled that same canvas to the 1536
 * display cap, so the two renderers disagreed on size while agreeing on the
 * wrong layout.
 *
 * So this asserts the properties no screenshot can self-report: the document
 * gets essentially the whole device width (not a chrome-squeezed slice), every
 * captured variant is 1:1 with that live layout (no renderer rescales), and
 * mobile is a genuinely different layout rather than the same one scaled. Real
 * browser, real capture path, NO LLM — it runs in the ordinary QA suite rather
 * than the measured (`*.eval.spec.ts`) one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, findFile, openFileByClick, fileCaptureUrl } from './flows';
import { test, METRICS_DIR } from './metrics';
import { IMAGE_RENDERERS, IMAGE_SIZES, VIEWPORT_WIDTH_PX } from './image-variants';

const FLOW = 'Capture Width';

/** PNG pixel dimensions, straight from the IHDR header — no image library. */
function pngSize(file: string): { width: number; height: number } {
  const head = fs.readFileSync(file).subarray(0, 24);
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

test.describe('capture matrix', () => {
  test.describe.configure({ timeout: 300_000 });

  test('captures every variant at its device width, in both renderers', async ({ page, request, metrics }) => {
    // Any file with a surface will do — this is about the capture, not the
    // document. A dashboard is always present in the tutorial seed.
    const dashboard = await findFile(request, 'dashboard');
    test.skip(!dashboard, 'no dashboard found on this deployment');

    await openFileByClick(page, 'dashboard', dashboard!);
    await expect(page.locator(`[data-file-id="${dashboard!.id}"]`)).toBeVisible({ timeout: 60_000 });

    await metrics.screenshot(page, FLOW, 'surface', { fileId: dashboard!.id });

    for (const size of IMAGE_SIZES) {
      // What the document ACTUALLY lays out at, on this device width, on the
      // chrome-free capture page — measured independently of the recorder.
      await page.setViewportSize({ width: VIEWPORT_WIDTH_PX[size], height: 900 });
      await page.goto(fileCaptureUrl(dashboard!.id));
      const view = page.locator(`[data-file-id="${dashboard!.id}"]`);
      await expect(view).toBeVisible({ timeout: 60_000 });
      const live = Math.round((await view.boundingBox())!.width);

      // The document gets essentially the whole device: only its own page
      // padding is missing. This is the assertion that fails when app chrome
      // (rails, an open side chat) squeezes the capture — that shipped once at
      // 708 of 1280, a 45% loss, and looked like a different design.
      expect(live / VIEWPORT_WIDTH_PX[size], `${size}: document must own the device width`).toBeGreaterThan(0.9);

      for (const renderer of IMAGE_RENDERERS) {
        const file = path.join(METRICS_DIR, 'screens', `capture-width-surface-${size}-${renderer}.png`);
        expect(fs.existsSync(file), `${size}:${renderer} should have been captured`).toBe(true);
        const { width, height } = pngSize(file);
        // 1:1 with the live layout — no renderer may rescale. Exact, because
        // "close enough" is how a 1184px view became a 1536px image.
        expect(width, `${size}:${renderer} must be 1:1 with the live ${live}px layout`).toBe(live);
        expect(height, `${size}:${renderer} should have real content`).toBeGreaterThan(200);
      }

      // Same box, same scale, so the pair differs only by renderer.
      const [pw, dl] = IMAGE_RENDERERS.map((renderer) =>
        pngSize(path.join(METRICS_DIR, 'screens', `capture-width-surface-${size}-${renderer}.png`)),
      );
      const skew = Math.abs(pw.height / pw.width - dl.height / dl.width) / (pw.height / pw.width);
      expect(skew, `${size}: renderers must agree on aspect ratio`).toBeLessThan(0.1);
    }

    // Mobile is a different LAYOUT, not the same one scaled: a phone-width
    // document is proportionally much taller. Without this, capturing both
    // sizes at one width would still pass everything above.
    const ratioAt = (size: 'laptop' | 'mobile') => {
      const s = pngSize(path.join(METRICS_DIR, 'screens', `capture-width-surface-${size}-playwright.png`));
      return s.height / s.width;
    };
    expect(ratioAt('mobile'), 'mobile must reflow taller than laptop').toBeGreaterThan(ratioAt('laptop') * 2);
  });
});
