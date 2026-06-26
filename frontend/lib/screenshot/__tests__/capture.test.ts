// @vitest-environment jsdom
// The non-hook capture core: renders a DOM element / FileView to an image Blob via
// html-to-image (mocked), with the colorMode-appropriate background.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('html-to-image', () => ({
  toJpeg: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
  toPng: vi.fn(async () => 'data:image/png;base64,BBBB'),
  getFontEmbedCSS: vi.fn(async () => '@font-face{font-family:Embedded;src:url(data:,)}'),
}));

import { toJpeg, toPng } from 'html-to-image';
import { captureElementBlob, captureFileViewBlob, captureRegionBlob, cropSourceRect, cappedOutputDims, regionPixelRatio } from '../capture';
import { AGENT_IMAGE_MAX_PX } from '../constants';

beforeEach(() => {
  vi.clearAllMocks();
  // fetch(dataURL).blob() — return a fake image blob without a network/codec
  global.fetch = vi.fn(async () => ({ blob: async () => new Blob(['img'], { type: 'image/jpeg' }) })) as unknown as typeof fetch;
});

function el(width = 1000): HTMLElement {
  const d = document.createElement('div');
  Object.defineProperty(d, 'offsetWidth', { value: width, configurable: true });
  return d;
}

describe('captureElementBlob', () => {
  it('returns an image Blob and uses the dark background for dark mode', async () => {
    const blob = await captureElementBlob(el(), { colorMode: 'dark' });
    expect(blob).toBeInstanceOf(Blob);
    expect(toJpeg).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ backgroundColor: '#0D1117' }));
  });

  it('uses the light background for light mode and honors format: png', async () => {
    await captureElementBlob(el(), { colorMode: 'light', format: 'png' });
    expect(toPng).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ backgroundColor: '#FAFBFC' }));
    expect(toJpeg).not.toHaveBeenCalled();
  });

  it('derives pixelRatio from maxWidth when given', async () => {
    await captureElementBlob(el(800), { colorMode: 'light', maxWidth: 400 });
    expect(toJpeg).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ pixelRatio: 0.5 }));
  });
});

describe('captureFileViewBlob', () => {
  it('finds the element by data-file-id and captures it', async () => {
    const node = el(800);
    node.setAttribute('data-file-id', '42');
    document.body.appendChild(node);
    const blob = await captureFileViewBlob(42, { colorMode: 'light' });
    expect(blob).toBeInstanceOf(Blob);
    node.remove();
  });

  it('throws a clear error when no element has that data-file-id', async () => {
    await expect(captureFileViewBlob(999, { colorMode: 'light' })).rejects.toThrow(/not found/);
  });
});

describe('cropSourceRect — viewport selection → source crop within the captured image', () => {
  it('maps a selection inside an element (no scroll) scaled by pixelRatio', () => {
    // target at (100,50); selection at viewport (150,80) sized 200x100; pr=2
    expect(cropSourceRect({ x: 150, y: 80, width: 200, height: 100 }, { left: 100, top: 50 }, 2))
      .toEqual({ sx: 100, sy: 60, sw: 400, sh: 200 });
  });

  it('handles a scrolled document.body (negative box top) so coords stay in image space', () => {
    // body scrolled down 300px → box.top = -300; a selection at viewport y=20 is 320px into the doc
    expect(cropSourceRect({ x: 0, y: 20, width: 50, height: 50 }, { left: 0, top: -300 }, 1))
      .toEqual({ sx: 0, sy: 320, sw: 50, sh: 50 });
  });

  it('clamps negative offsets to 0 and zero sizes to at least 1', () => {
    expect(cropSourceRect({ x: 0, y: 0, width: 0, height: 0 }, { left: 10, top: 10 }, 1))
      .toEqual({ sx: 0, sy: 0, sw: 1, sh: 1 });
  });
});

describe('captureRegionBlob — crop frame is snapshotted BEFORE the async render (no drift offset)', () => {
  // Why this matters: the selection rect is in viewport coords captured at drag time. If the crop
  // reads the target's getBoundingClientRect() AFTER the (slow, esp. in dev) html-to-image render,
  // any layout shift in between (page scroll, the pending-upload chip reflow) slides the crop — the
  // dev-vs-prod offset. These tests pin the crop to the pre-render frame.
  let drawImage: ReturnType<typeof vi.fn>;
  let createElementSpy: ReturnType<typeof vi.spyOn>;
  let OriginalImage: typeof Image;

  beforeEach(() => {
    drawImage = vi.fn();
    const fakeCanvas = {
      width: 0, height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(['x'], { type: 'image/jpeg' })),
    };
    const realCreate = document.createElement.bind(document);
    createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(
      (tag: string) => (tag === 'canvas' ? (fakeCanvas as unknown as HTMLCanvasElement) : realCreate(tag)),
    );
    OriginalImage = global.Image;
    // Image whose `src` setter resolves onload on the next microtask (no real decode).
    global.Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) { Promise.resolve().then(() => this.onload?.()); }
      get src() { return ''; }
    } as unknown as typeof Image;
  });

  afterEach(() => {
    createElementSpy.mockRestore();
    global.Image = OriginalImage;
  });

  function targetAt(left: number, top: number): HTMLElement {
    const d = document.createElement('div');
    d.getBoundingClientRect = () => ({ left, top, right: left, bottom: top, width: 0, height: 0, x: left, y: top, toJSON() {} }) as DOMRect;
    return d;
  }

  it('uses the rect read at entry, even if the element moves DURING the render', async () => {
    const target = targetAt(100, 50);
    // Simulate layout drift: while html-to-image "renders", the target slides up 40px.
    vi.mocked(toJpeg).mockImplementationOnce(async () => {
      target.getBoundingClientRect = () => ({ left: 100, top: 10, right: 100, bottom: 10, width: 0, height: 0, x: 100, y: 10, toJSON() {} }) as DOMRect;
      return 'data:image/jpeg;base64,AAAA';
    });
    await captureRegionBlob({ x: 150, y: 80, width: 200, height: 100 }, { colorMode: 'light', target, pixelRatio: 1 });
    // sy must use the PRE-render top (50) → 80-50=30, NOT the drifted top (10) → 70.
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 50, 30, 200, 100, 0, 0, 200, 100);
  });

  it('prefers an explicit targetBox (snapshotted at selection time) over the live element rect', async () => {
    const target = targetAt(999, 999); // live rect is already wrong/drifted
    await captureRegionBlob({ x: 150, y: 80, width: 200, height: 100 }, { colorMode: 'light', target, targetBox: { left: 100, top: 50 }, pixelRatio: 1 });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 50, 30, 200, 100, 0, 0, 200, 100);
  });

  it('rasterizes the target at a REDUCED pixelRatio when the selection exceeds the 512px cap (no wasted work)', async () => {
    const target = targetAt(0, 0);
    // 2000px-wide selection, default 512 cap, deviceCap forced to 2 → render whole target at 512/2000 = 0.256×,
    // NOT at device DPR. The cropped selection (2000×0.256 = 512) already lands at the cap → drawn ~1:1.
    await captureRegionBlob({ x: 0, y: 0, width: 2000, height: 1000 }, { colorMode: 'light', target, pixelRatio: 2 });
    expect(toJpeg).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ pixelRatio: expect.closeTo(0.256) }));
    expect(drawImage).toHaveBeenCalledWith(
      expect.anything(),
      expect.closeTo(0), expect.closeTo(0), expect.closeTo(512), expect.closeTo(256),
      0, 0, 512, 256,
    );
  });
});

describe('regionPixelRatio — render no finer than the output cap needs', () => {
  it('exposes the agent image cap as 512px', () => {
    expect(AGENT_IMAGE_MAX_PX).toBe(512);
  });

  it('scales DOWN for a selection larger than the cap (less rasterization work)', () => {
    // 2000px-wide selection, cap 512 → render the target at 512/2000 = 0.256×
    expect(regionPixelRatio({ width: 2000, height: 1000 }, 512, 2)).toBeCloseTo(0.256);
  });

  it('never exceeds the device cap for a small selection (no upscaling past the screen)', () => {
    expect(regionPixelRatio({ width: 100, height: 80 }, 512, 2)).toBe(2);
  });

  it('uses the longest side so a tall-narrow selection still fits the cap', () => {
    expect(regionPixelRatio({ width: 100, height: 2000 }, 512, 1)).toBeCloseTo(0.256);
  });
});

describe('cappedOutputDims — keep region crops from becoming huge', () => {
  it('leaves dimensions untouched when both are within the cap', () => {
    expect(cappedOutputDims(800, 600, 1024)).toEqual({ w: 800, h: 600 });
  });

  it('scales down (preserving aspect) when the longest side exceeds the cap', () => {
    expect(cappedOutputDims(2000, 1000, 1024)).toEqual({ w: 1024, h: 512 });
    expect(cappedOutputDims(1000, 2000, 1024)).toEqual({ w: 512, h: 1024 });
  });

  it('never returns a zero dimension', () => {
    expect(cappedOutputDims(0.4, 0.2, 1024)).toEqual({ w: 1, h: 1 });
  });
});
