/**
 * tileViewportRect (Renderer_v2 Phase 8c): windowing visibility math for tiles that live inside
 * the dashboard IFRAME surface. A tile's getBoundingClientRect is relative to ITS OWN frame's
 * viewport, while scrolling happens in the TOP document — so the rect must be composed up
 * through the frame chain and measured against the TOP viewport, or every tile inside a
 * content-height iframe measures "visible" and windowing silently dies.
 */
import { describe, it, expect } from 'vitest';
import { tileViewportRect } from '../WindowedTile';

const rect = (top: number, bottom: number) =>
  ({ top, bottom, width: 100, height: bottom - top }) as DOMRect;

function fakeEl(r: DOMRect, win: unknown): Element {
  return {
    getBoundingClientRect: () => r,
    ownerDocument: { defaultView: win, documentElement: { clientHeight: 0 } },
  } as unknown as Element;
}

describe('tileViewportRect', () => {
  it('returns the element rect and window viewport directly when not framed', () => {
    const win = { frameElement: null, innerHeight: 900 };
    const out = tileViewportRect(fakeEl(rect(100, 400), win));
    expect(out).toEqual({ top: 100, bottom: 400, viewportHeight: 900, empty: false });
  });

  it('composes the frame offset and uses the TOP viewport for a tile inside an iframe', () => {
    const topWin: Record<string, unknown> = { frameElement: null, innerHeight: 800 };
    topWin.parent = topWin;
    const frameEl = { getBoundingClientRect: () => rect(500, 3500) };
    const innerWin = { frameElement: frameEl, parent: topWin, innerHeight: 3000 };
    // Tile at 2000 inside the iframe; iframe starts at 500 in the (scrolled) top viewport →
    // effective top = 2500, far below the 800px top viewport + overscan.
    const out = tileViewportRect(fakeEl(rect(2000, 2300), innerWin));
    expect(out).toEqual({ top: 2500, bottom: 2800, viewportHeight: 800, empty: false });
  });

  it('survives a frameElement access that throws (cross-origin ancestor): falls back to own frame', () => {
    const innerWin = {
      get frameElement(): Element | null { throw new Error('cross-origin'); },
      innerHeight: 700,
    };
    const out = tileViewportRect(fakeEl(rect(10, 20), innerWin));
    expect(out).toEqual({ top: 10, bottom: 20, viewportHeight: 700, empty: false });
  });

  it('flags an all-zero rect as EMPTY — pre-layout, visibility unknowable (Firefox iframe quirk)', () => {
    // Firefox returns 0/0/0x0 for iframe content that has not been reflowed yet; treating that
    // as "at the viewport origin → visible" hydrated every below-fold tile at mount and
    // silently killed windowing (matrix catch). An empty rect must NOT read as visible.
    const win = { frameElement: null, innerHeight: 900 };
    const zero = { top: 0, bottom: 0, width: 0, height: 0 } as DOMRect;
    const out = tileViewportRect(fakeEl(zero, win));
    expect(out.empty).toBe(true);
  });
});
