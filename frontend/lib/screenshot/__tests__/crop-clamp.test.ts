// Pure geometry for the SVG-story region crop, CLAMPED to the surface box so a selection
// straying outside the story crops the in-bounds part + leaves bg margins (never the black an
// un-renderable iframe clone produced). No DOM — pure math.
import { describe, it, expect } from 'vitest';
import { clampedSvgCropRects } from '../capture';

const BOX = { left: 100, top: 50, width: 400, height: 300 };
const RATIO = 2; // rasterized image is 2× the viewport box
const MAX = 100000; // no output cap for most cases

describe('clampedSvgCropRects', () => {
  it('fully-inside selection fills the whole canvas (no regression from the old path)', () => {
    const r = clampedSvgCropRects({ x: 150, y: 100, width: 200, height: 150 }, BOX, RATIO, MAX)!;
    expect(r.canvas).toEqual({ w: 400, h: 300 });
    expect(r.src).toEqual({ sx: 100, sy: 100, sw: 400, sh: 300 });
    // Destination covers the whole canvas → nothing is bg.
    expect(r.dst).toEqual({ dx: 0, dy: 0, dw: 400, dh: 300 });
  });

  it('selection overflowing right/bottom clamps the source and leaves right/bottom margins', () => {
    const r = clampedSvgCropRects({ x: 400, y: 250, width: 200, height: 150 }, BOX, RATIO, MAX)!;
    expect(r.canvas).toEqual({ w: 400, h: 300 });
    // Only the 100×100 overlap is drawn, from the surface's far corner…
    expect(r.src).toEqual({ sx: 600, sy: 400, sw: 200, sh: 200 });
    // …at the top-left of the canvas; the rest (right + bottom) stays background.
    expect(r.dst).toEqual({ dx: 0, dy: 0, dw: 200, dh: 200 });
  });

  it('selection overflowing left/top offsets the destination (left/top margins are bg)', () => {
    const r = clampedSvgCropRects({ x: 50, y: 20, width: 150, height: 100 }, BOX, RATIO, MAX)!;
    expect(r.canvas).toEqual({ w: 300, h: 200 });
    expect(r.src).toEqual({ sx: 0, sy: 0, sw: 200, sh: 140 });
    // Drawn offset from the origin, so the out-of-bounds left/top band is bg.
    expect(r.dst).toEqual({ dx: 100, dy: 60, dw: 200, dh: 140 });
  });

  it('returns null when the selection does not overlap the surface at all', () => {
    expect(clampedSvgCropRects({ x: 600, y: 400, width: 50, height: 50 }, BOX, RATIO, MAX)).toBeNull();
  });

  it('applies the output cap, scaling destination + canvas together', () => {
    // fullW=400, fullH=300, cap longest to 200 → scale 0.5 → canvas 200×150, outScale 0.5.
    const r = clampedSvgCropRects({ x: 150, y: 100, width: 200, height: 150 }, BOX, RATIO, 200)!;
    expect(r.canvas).toEqual({ w: 200, h: 150 });
    expect(r.dst).toEqual({ dx: 0, dy: 0, dw: 200, dh: 150 });
  });
});
