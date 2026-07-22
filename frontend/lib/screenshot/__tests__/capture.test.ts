// @vitest-environment jsdom
// The non-hook capture core: renders a DOM element / FileView to an image Blob via the
// serialization pipeline (serializeElementToSvg → svgToImage → canvas), mocked here — jsdom can't
// rasterize. snapdom is GONE (Story_Design_V2 §4): every capture path goes through serialization.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  serializeElementToSvg: vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"/>'),
  svgToImage: vi.fn(async () => ({ naturalWidth: 0, naturalHeight: 0 } as unknown as HTMLImageElement)),
}));

vi.mock('../serialize-element', async (orig) => ({
  ...(await orig() as Record<string, unknown>),
  serializeElementToSvg: h.serializeElementToSvg,
}));

vi.mock('@/lib/story-surface/serialize', async (orig) => ({
  ...(await orig() as Record<string, unknown>),
  svgToImage: h.svgToImage,
}));

import { captureElementBlob, captureFileViewBlob, captureRegionBlob, cropSourceRect, cappedOutputDims, regionPixelRatio } from '../capture';
import { AGENT_IMAGE_MAX_PX } from '../constants';

/** Records canvas state at toBlob time (dims, fillStyle, type) + every drawImage call. */
const made: Array<{ width: number; height: number; fillStyle: string; type: string }> = [];
let drawImage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  made.length = 0;
  drawImage = vi.fn();
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    const ctx = { fillRect: vi.fn(), drawImage, fillStyle: '' };
    (this as unknown as { __ctx: typeof ctx }).__ctx = ctx;
    return ctx;
  } as unknown as HTMLCanvasElement['getContext'];
  HTMLCanvasElement.prototype.toBlob = function (this: HTMLCanvasElement, cb: BlobCallback, type?: string) {
    const ctx = (this as unknown as { __ctx?: { fillStyle: string } }).__ctx;
    made.push({ width: this.width, height: this.height, fillStyle: ctx?.fillStyle ?? '', type: type ?? '' });
    cb(new Blob(['img'], { type: type ?? 'image/jpeg' }));
  } as HTMLCanvasElement['toBlob'];
});

afterEach(() => {
  document.body.innerHTML = '';
});

function el(width = 1000, height = 500): HTMLElement {
  const d = document.createElement('div');
  Object.defineProperty(d, 'offsetWidth', { value: width, configurable: true });
  Object.defineProperty(d, 'offsetHeight', { value: height, configurable: true });
  return d;
}

describe('captureElementBlob — serialization capture, no snapdom', () => {
  it('serializes the element and returns a jpeg Blob with the dark background for dark mode', async () => {
    const blob = await captureElementBlob(el(), { colorMode: 'dark' });
    expect(blob).toBeInstanceOf(Blob);
    expect(h.serializeElementToSvg).toHaveBeenCalledTimes(1);
    expect(h.svgToImage).toHaveBeenCalledTimes(1);
    expect(made[0].fillStyle).toBe('#0D1117');
    expect(made[0].type).toBe('image/jpeg');
  });

  it('uses the light background for light mode and honors format: png', async () => {
    await captureElementBlob(el(), { colorMode: 'light', format: 'png' });
    expect(made[0].fillStyle).toBe('#FAFBFC');
    expect(made[0].type).toBe('image/png');
  });

  it('scales the RASTER to hit maxWidth (no reflow) — maxWidth/offsetWidth', async () => {
    await captureElementBlob(el(800, 400), { colorMode: 'light', maxWidth: 400 });
    expect(made[0].width).toBe(400); // 800 × 0.5
    expect(made[0].height).toBe(200);
  });

  it('scales by pixelRatio (default 0.75) when no maxWidth is given', async () => {
    await captureElementBlob(el(800, 400), { colorMode: 'light' });
    expect(made[0].width).toBe(600);
    expect(made[0].height).toBe(300);
  });

  it('forwards the node filter to the serializer (overlay exclusion)', async () => {
    const filter = (n: Element) => !n.hasAttribute('data-x');
    await captureElementBlob(el(), { colorMode: 'light', filter });
    expect(h.serializeElementToSvg).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ filter }));
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

  // Embeds hydrate ASYNCHRONOUSLY (chart queries, inline numbers, metric tiles): a capture fired
  // while the view still shows busy markers rasterizes blank tiles and missing charts — the
  // "Get image gives me a story without the numbers and the lines" bug. The readiness gate
  // (data-mx-busy, incl. inside the story iframe) must be part of the capture itself so EVERY
  // caller (dev panel pre-capture, file health, chat attachments) is correct by default.
  it('waits for the view\'s busy markers to clear before capturing', async () => {
    const view = el();
    view.setAttribute('data-file-id', '9');
    const busy = document.createElement('div');
    busy.setAttribute('data-mx-busy', 'true');
    view.appendChild(busy);
    document.body.appendChild(view);
    let resolved = false;
    const p = captureFileViewBlob(9, { colorMode: 'light' }).then((b) => { resolved = true; return b; });
    // Longer than the settle window: while busy, nothing may have been serialized.
    await new Promise((r) => setTimeout(r, 450));
    expect(h.serializeElementToSvg).not.toHaveBeenCalled();
    expect(resolved).toBe(false);
    busy.remove(); // embed finished hydrating
    expect(await p).toBeInstanceOf(Blob);
    expect(h.serializeElementToSvg).toHaveBeenCalledTimes(1);
  });

  it('throws a clear error when no element has that data-file-id', async () => {
    await expect(captureFileViewBlob(999, { colorMode: 'light' })).rejects.toThrow(/not found/);
  });
});

describe('cropSourceRect — viewport selection → source crop within the captured image', () => {
  it('maps a selection inside an element (no scroll) scaled by pixelRatio', () => {
    expect(cropSourceRect({ x: 150, y: 80, width: 200, height: 100 }, { left: 100, top: 50 }, 2))
      .toEqual({ sx: 100, sy: 60, sw: 400, sh: 200 });
  });

  it('handles a scrolled document.body (negative box top) so coords stay in image space', () => {
    expect(cropSourceRect({ x: 0, y: 20, width: 50, height: 50 }, { left: 0, top: -300 }, 1))
      .toEqual({ sx: 0, sy: 320, sw: 50, sh: 50 });
  });

  it('clamps negative offsets to 0 and zero sizes to at least 1', () => {
    expect(cropSourceRect({ x: 0, y: 0, width: 0, height: 0 }, { left: 10, top: 10 }, 1))
      .toEqual({ sx: 0, sy: 0, sw: 1, sh: 1 });
  });
});

describe('captureRegionBlob — crop frame is snapshotted BEFORE the async render (no drift offset)', () => {
  function targetAt(left: number, top: number): HTMLElement {
    const d = document.createElement('div');
    d.getBoundingClientRect = () => ({ left, top, right: left, bottom: top, width: 0, height: 0, x: left, y: top, toJSON() {} }) as DOMRect;
    return d;
  }

  it('uses the rect read at entry, even if the element moves DURING the render', async () => {
    const target = targetAt(100, 50);
    // Simulate layout drift: while the serializer runs, the target slides up 40px.
    h.serializeElementToSvg.mockImplementationOnce(async () => {
      target.getBoundingClientRect = () => ({ left: 100, top: 10, right: 100, bottom: 10, width: 0, height: 0, x: 100, y: 10, toJSON() {} }) as DOMRect;
      return '<svg xmlns="http://www.w3.org/2000/svg"/>';
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

  it('caps the OUTPUT at the 512px agent cap for a large selection', async () => {
    const target = targetAt(0, 0);
    // 2000×1000 selection, deviceCap 2 → output scaled by regionPixelRatio to land at the cap.
    await captureRegionBlob({ x: 0, y: 0, width: 2000, height: 1000 }, { colorMode: 'light', target, pixelRatio: 2 });
    expect(made[0].width).toBe(512);
    expect(made[0].height).toBe(256);
    expect(drawImage).toHaveBeenCalledWith(
      expect.anything(),
      expect.closeTo(0), expect.closeTo(0), expect.closeTo(2000), expect.closeTo(1000),
      0, 0, 512, 256,
    );
  });
});

describe('regionPixelRatio — render no finer than the output cap needs', () => {
  it('exposes the agent image cap as 512px', () => {
    expect(AGENT_IMAGE_MAX_PX).toBe(512);
  });

  it('scales DOWN for a selection larger than the cap (less rasterization work)', () => {
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
