/**
 * Region-crop coordinate space for iframe-hosted svg surfaces (stories AND — Phase 8 —
 * dashboards): the drag selection is in TOP-viewport coordinates, while the surface svg's own
 * getBoundingClientRect is relative to ITS IFRAME's viewport. The containment check and crop
 * origin must compose the iframe element's top-document offset, or every crop lands shifted by
 * the iframe's page position (header height + scroll).
 */
import { describe, it, expect } from 'vitest';
import { svgBoxInTopViewport } from '../capture';

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;

describe('svgBoxInTopViewport', () => {
  it('returns the svg box unchanged when the svg lives in the top document', () => {
    const svg = {
      getBoundingClientRect: () => rect(10, 20, 300, 400),
      ownerDocument: { defaultView: { frameElement: null } },
    } as unknown as SVGSVGElement;
    expect(svgBoxInTopViewport(svg)).toEqual({ left: 10, top: 20, width: 300, height: 400 });
  });

  it('offsets by the iframe element rect when the svg lives inside a frame', () => {
    const frameEl = { getBoundingClientRect: () => rect(40, 120, 900, 2000) };
    const topWin: Record<string, unknown> = { frameElement: null };
    topWin.parent = topWin;
    const innerWin = { frameElement: frameEl, parent: topWin };
    const svg = {
      getBoundingClientRect: () => rect(0, 0, 900, 1800),
      ownerDocument: { defaultView: innerWin },
    } as unknown as SVGSVGElement;
    expect(svgBoxInTopViewport(svg)).toEqual({ left: 40, top: 120, width: 900, height: 1800 });
  });

  it('survives a cross-origin frameElement access (stops at the last same-origin frame)', () => {
    const innerWin = {
      get frameElement(): Element | null { throw new Error('cross-origin'); },
    };
    const svg = {
      getBoundingClientRect: () => rect(5, 6, 70, 80),
      ownerDocument: { defaultView: innerWin },
    } as unknown as SVGSVGElement;
    expect(svgBoxInTopViewport(svg)).toEqual({ left: 5, top: 6, width: 70, height: 80 });
  });
});
