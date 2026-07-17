/**
 * The whole point of the SVG renderer: STORIES NO LONGER GO THROUGH SNAPDOM.
 *
 * This drives the real `captureElementBlob` / `captureRegionBlob` entry points and asserts the
 * routing contract that makes that true:
 *  - an SVG-rendered story rasterizes by serializing its LIVE surface — snapdom is never called;
 *  - everything else (dashboards/questions/notebooks, and DOM-rendered stories) still uses snapdom,
 *    because their styles live in the PARENT document and would serialize unstyled.
 *
 * snapdom + the SVG rasterize step are mocked: jsdom can't rasterize an SVG or a canvas, and what
 * matters here is WHICH engine each surface routes to, not the pixels (pixels are verified in-browser).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  toBlob: vi.fn(async () => new Blob(['snapdom'], { type: 'image/jpeg' })),
  toCanvas: vi.fn(async () => document.createElement('canvas')),
  svgToImage: vi.fn(async () => ({ naturalWidth: 1280, naturalHeight: 400 } as unknown as HTMLImageElement)),
  serializeStorySvg: vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg"/>'),
}));

vi.mock('@zumer/snapdom', () => ({ snapdom: { toBlob: h.toBlob, toCanvas: h.toCanvas } }));

vi.mock('@/lib/story-surface/serialize', async (orig) => ({
  ...(await orig() as Record<string, unknown>),
  svgToImage: h.svgToImage,
  serializeStorySvg: h.serializeStorySvg,
}));

import { captureElementBlob } from '@/lib/screenshot/capture';
import { mountStorySurface } from '@/lib/story-surface';

/** A file-view host containing an iframe whose document hosts the given surface. */
function hostWithSurface(kind: 'dom' | 'svg'): HTMLElement {
  const host = document.createElement('div');
  const iframe = document.createElement('iframe');
  host.appendChild(iframe);
  document.body.appendChild(host);
  const surface = mountStorySurface(iframe.contentDocument!, kind, 1280);
  surface.root.innerHTML = '<h1>Story</h1>';
  if (surface.svg) {
    // jsdom has no layout — give the svg a real box so the capture can size its output.
    surface.svg.getBoundingClientRect = () => ({ width: 1280, height: 400, left: 0, top: 0, right: 1280, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  }
  return host;
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  // Minimal 2d-context + toBlob stubs so the SVG path can compose its output canvas.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '',
  })) as unknown as HTMLCanvasElement['getContext'];
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob(['svgpath'], { type: 'image/jpeg' }));
  } as HTMLCanvasElement['toBlob'];
});

const opts = { colorMode: 'light' as const, maxWidth: 512, format: 'jpeg' as const };

describe('captureElementBlob — SVG stories bypass snapdom', () => {
  it('serializes the live surface and NEVER calls snapdom', async () => {
    const blob = await captureElementBlob(hostWithSurface('svg'), opts);
    expect(h.serializeStorySvg).toHaveBeenCalledTimes(1);
    expect(h.svgToImage).toHaveBeenCalledTimes(1);
    expect(h.toBlob).not.toHaveBeenCalled(); // the whole point
    expect(blob).toBeInstanceOf(Blob);
  });

  it('DOM-rendered stories still use snapdom (no svg surface to serialize)', async () => {
    await captureElementBlob(hostWithSurface('dom'), opts);
    expect(h.serializeStorySvg).not.toHaveBeenCalled();
    expect(h.toBlob).toHaveBeenCalledTimes(1);
  });

  it('non-story elements (dashboard/question) still use snapdom', async () => {
    const el = document.createElement('div');
    el.innerHTML = '<div class="dashboard"><svg><rect /></svg></div>';
    document.body.appendChild(el);
    await captureElementBlob(el, opts);
    expect(h.serializeStorySvg).not.toHaveBeenCalled();
    expect(h.toBlob).toHaveBeenCalledTimes(1);
  });

  it('a failed serialize does not silently fall back to snapdom (the bug would be a silent perf regression)', async () => {
    h.serializeStorySvg.mockRejectedValueOnce(new Error('boom'));
    await expect(captureElementBlob(hostWithSurface('svg'), opts)).rejects.toThrow('boom');
    expect(h.toBlob).not.toHaveBeenCalled();
  });
});
