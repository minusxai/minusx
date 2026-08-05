/**
 * The parts of the QA capture contract that are checkable without a browser.
 *
 * The browser half lives in `test/qa/capture-width.spec.ts` (pixel widths of
 * real captures). What is pinned here is the reasoning those captures depend
 * on: the widths are DEVICE widths tied to the app's own canonical canvas, and
 * the capture page is chrome-free — the two facts that were wrong when a
 * "laptop" image turned out to be a 708px column.
 */
import { describe, it, expect } from 'vitest';
import { STORY_CANVAS_WIDTH } from '@/lib/story-surface';
import { VIEWPORT_WIDTH_PX, IMAGE_SIZES, IMAGE_RENDERERS, allVariants, variantKey } from '../image-variants';
import { fileCaptureUrl } from '../flows';

describe('capture widths', () => {
  it('captures laptop at the app\'s own canonical story canvas', () => {
    // Not a coincidence to be re-tuned: a story is authored against this width
    // and `lib/headless-capture` renders at it. Drifting from it means judging
    // a layout band no reader is in.
    expect(VIEWPORT_WIDTH_PX.laptop).toBe(STORY_CANVAS_WIDTH);
  });

  it('captures mobile at a phone width, far below the laptop one', () => {
    expect(VIEWPORT_WIDTH_PX.mobile).toBe(390);
    expect(VIEWPORT_WIDTH_PX.mobile).toBeLessThan(VIEWPORT_WIDTH_PX.laptop / 2);
  });

  it('declares a width for every size, and a distinct key per variant', () => {
    for (const size of IMAGE_SIZES) expect(VIEWPORT_WIDTH_PX[size]).toBeGreaterThan(0);
    const keys = allVariants().map(variantKey);
    expect(keys).toHaveLength(IMAGE_SIZES.length * IMAGE_RENDERERS.length);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('fileCaptureUrl', () => {
  it('strips app chrome so the document owns the viewport', () => {
    // `contentonly` is the top of the view ladder: no left sidebar, no top bar,
    // no file header, no right/chat sidebar. Without it the surface is measured
    // against whatever the chrome leaves over.
    expect(fileCaptureUrl(42)).toContain('view=contentonly');
  });

  it('stays inside tutorial mode and carries the e2e opt-in', () => {
    const url = fileCaptureUrl(42);
    expect(url.startsWith('/f/42?')).toBe(true);
    expect(url).toContain('mode=tutorial'); // never production files
    expect(url).toContain('e2e='); // the app capture hook is behind this gate
  });
});
