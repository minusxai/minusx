/**
 * Slide thumbnail crop math — one surface capture, one crop per slide.
 * Pure geometry: source rects in surface coordinates, dest sizes in device pixels.
 */
import { describe, it, expect } from 'vitest';
import { thumbCropRects, THUMB_MAX_ASPECT } from '../slide-thumbs';

describe('thumbCropRects', () => {
  it('maps each slide band to a crop at the thumb scale', () => {
    const rects = thumbCropRects(1280, [
      { top: 0, height: 800 },
      { top: 800, height: 800 },
    ], 160, 2);
    // scale = 160/1280 = 0.125, dpr 2 → dest width 320
    expect(rects[0]).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 800, dw: 320, dh: 200 });
    expect(rects[1]).toEqual({ sx: 0, sy: 800, sw: 1280, sh: 800, dw: 320, dh: 200 });
  });

  it('clamps a very tall slide to the max aspect, cropping from its top', () => {
    const [r] = thumbCropRects(1000, [{ top: 100, height: 9000 }], 100, 1);
    expect(r.sh).toBe(1000 * THUMB_MAX_ASPECT); // source band capped
    expect(r.dh).toBe(100 * THUMB_MAX_ASPECT);  // dest follows the same aspect
    expect(r.sy).toBe(100);                     // still anchored at the slide top
  });

  it('never emits zero-sized crops', () => {
    const [r] = thumbCropRects(1280, [{ top: 10, height: 0.4 }], 160, 2);
    expect(r.sh).toBeGreaterThan(0);
    expect(r.dh).toBeGreaterThanOrEqual(1);
  });
});
