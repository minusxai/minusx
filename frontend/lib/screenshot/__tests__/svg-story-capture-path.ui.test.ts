/**
 * Capture routing after snapdom removal (Story_Design_V2 §4): EVERYTHING serializes.
 *
 * This drives the real `captureElementBlob` entry point and asserts the routing contract:
 *  - an SVG-rendered story rasterizes by serializing its LIVE surface (serializeStorySvg) —
 *    the generic element serializer is never invoked for it;
 *  - everything else (dashboards/questions/notebooks, and DOM-rendered stories) goes through the
 *    generic serialization capture (serializeElementToSvg), which clones the subtree with the
 *    parent document's stylesheets inlined.
 *
 * The serialize + rasterize steps are mocked: jsdom can't rasterize an SVG or a canvas, and what
 * matters here is WHICH serializer each surface routes to, not the pixels (pixels are verified
 * in-browser by the three-engine capture matrix).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  serializeElementToSvg: vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"/>'),
  svgToImage: vi.fn(async () => ({ naturalWidth: 1280, naturalHeight: 400 } as unknown as HTMLImageElement)),
  serializeStorySvg: vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg"/>'),
}));

vi.mock('@/lib/screenshot/serialize-element', async (orig) => ({
  ...(await orig() as Record<string, unknown>),
  serializeElementToSvg: h.serializeElementToSvg,
}));

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
  Object.defineProperty(host, 'offsetWidth', { value: 1280, configurable: true });
  Object.defineProperty(host, 'offsetHeight', { value: 400, configurable: true });
  return host;
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  // Minimal 2d-context + toBlob stubs so both paths can compose their output canvas.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '',
  })) as unknown as HTMLCanvasElement['getContext'];
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob(['raster'], { type: 'image/jpeg' }));
  } as HTMLCanvasElement['toBlob'];
});

const opts = { colorMode: 'light' as const, maxWidth: 512, format: 'jpeg' as const };

describe('captureElementBlob — SVG stories serialize their live surface', () => {
  it('serializes the story surface, never the generic element path', async () => {
    const blob = await captureElementBlob(hostWithSurface('svg'), opts);
    expect(h.serializeStorySvg).toHaveBeenCalledTimes(1);
    expect(h.svgToImage).toHaveBeenCalledTimes(1);
    expect(h.serializeElementToSvg).not.toHaveBeenCalled(); // story path is its own serializer
    expect(blob).toBeInstanceOf(Blob);
  });

  it('DOM-rendered stories use the generic serialization capture (no svg surface to serialize)', async () => {
    await captureElementBlob(hostWithSurface('dom'), opts);
    expect(h.serializeStorySvg).not.toHaveBeenCalled();
    expect(h.serializeElementToSvg).toHaveBeenCalledTimes(1);
  });

  it('non-story elements (dashboard/question) use the generic serialization capture', async () => {
    const el = document.createElement('div');
    el.innerHTML = '<div class="dashboard"><svg><rect /></svg></div>';
    Object.defineProperty(el, 'offsetWidth', { value: 800, configurable: true });
    Object.defineProperty(el, 'offsetHeight', { value: 600, configurable: true });
    document.body.appendChild(el);
    await captureElementBlob(el, opts);
    expect(h.serializeStorySvg).not.toHaveBeenCalled();
    expect(h.serializeElementToSvg).toHaveBeenCalledTimes(1);
  });

  it('a failed story serialize does not silently fall back to the generic path', async () => {
    h.serializeStorySvg.mockRejectedValueOnce(new Error('boom'));
    await expect(captureElementBlob(hostWithSurface('svg'), opts)).rejects.toThrow('boom');
    expect(h.serializeElementToSvg).not.toHaveBeenCalled();
  });
});
