/**
 * Marker OVERLAY contract (user directive): markers reuse the padding inherent in the file view —
 * the badge column paints OVER the content's own left padding and the band lines run across the
 * content, exactly like the live PageMarkerDevOverlay. The gutter must NOT add extra width to the
 * agent image (the old behavior prepended a 40px strip, making the capture wider than the view).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { drawMarkerGutter } from '@/lib/screenshot/draw-markers';

/** Minimal recording 2D-context stub (jsdom has no real canvas). */
function stubCtx() {
  const calls: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string) {
      if (prop === 'calls') return calls;
      return (..._args: unknown[]) => { calls.push(prop); };
    },
    set() { return true; },
  });
  return ctx as unknown as CanvasRenderingContext2D & { calls: string[] };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('drawMarkerGutter (overlay mode)', () => {
  it('returns a canvas of the SAME width as the content — markers overlay, never widen', () => {
    const content = document.createElement('canvas');
    content.width = 512;
    content.height = 900;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => stubCtx() as never);
    const out = drawMarkerGutter(content, { docHeightCssPx: 2400, colorMode: 'dark' });
    expect(out.width).toBe(512);
    expect(out.height).toBe(900);
  });

  it('still no-ops safely on empty content', () => {
    const content = document.createElement('canvas');
    content.width = 0;
    content.height = 0;
    const out = drawMarkerGutter(content, { docHeightCssPx: 1000, colorMode: 'light' });
    expect(out).toBe(content);
  });
});
