// @vitest-environment jsdom
// The non-hook capture core: renders a DOM element / FileView to an image Blob via
// html-to-image (mocked), with the colorMode-appropriate background.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('html-to-image', () => ({
  toJpeg: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
  toPng: vi.fn(async () => 'data:image/png;base64,BBBB'),
}));

import { toJpeg, toPng } from 'html-to-image';
import { captureElementBlob, captureFileViewBlob } from '../capture';

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
