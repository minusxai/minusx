import { describe, it, expect } from 'vitest';
import {
  estimateTextTokens,
  estimateImageTokens,
  imageDimensionsFromBase64,
  IMAGE_TOKEN_FALLBACK,
} from '@/lib/convo-debug/approx';

/** Build a minimal PNG (signature + IHDR) with the given dimensions, base64-encoded. */
function pngBase64(width: number, height: number): string {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // signature
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return Buffer.from(bytes).toString('base64');
}

/** Build a minimal JPEG (SOI + SOF0 frame header) with the given dimensions, base64-encoded. */
function jpegBase64(width: number, height: number): string {
  const bytes = new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0 segment (length 4)
    0xff, 0xc0, 0x00, 0x0b, 0x08, // SOF0, length 11, precision 8
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00, // 1 component
  ]);
  return Buffer.from(bytes).toString('base64');
}

describe('estimateTextTokens', () => {
  it('returns 0 for empty text', () => {
    expect(estimateTextTokens('')).toBe(0);
  });

  it('rounds up chars/4 and floors at 1 for non-empty text', () => {
    expect(estimateTextTokens('ab')).toBe(1);
    expect(estimateTextTokens('a'.repeat(8))).toBe(2);
    expect(estimateTextTokens('a'.repeat(9))).toBe(3);
  });
});

describe('imageDimensionsFromBase64', () => {
  it('parses PNG dimensions', () => {
    expect(imageDimensionsFromBase64(pngBase64(512, 384), 'image/png')).toEqual({ width: 512, height: 384 });
  });

  it('parses JPEG dimensions', () => {
    expect(imageDimensionsFromBase64(jpegBase64(300, 150), 'image/jpeg')).toEqual({ width: 300, height: 150 });
  });

  it('returns null for garbage', () => {
    expect(imageDimensionsFromBase64('bm90IGFuIGltYWdl', 'image/png')).toBeNull();
  });
});

describe('estimateImageTokens', () => {
  it('uses (w×h)/750 for base64 images with parseable dims', () => {
    // 750×750 = 562500 / 750 = 750 tokens
    expect(estimateImageTokens({ type: 'image', data: pngBase64(750, 750), mimeType: 'image/png' })).toBe(750);
  });

  it('caps at 1600 tokens (Anthropic max) for huge images', () => {
    expect(estimateImageTokens({ type: 'image', data: pngBase64(4000, 4000), mimeType: 'image/png' })).toBe(1600);
  });

  it('falls back to the flat estimate for url images', () => {
    expect(estimateImageTokens({ type: 'image', url: 'https://example.com/img.png' })).toBe(IMAGE_TOKEN_FALLBACK);
  });

  it('falls back to the flat estimate for unparseable base64', () => {
    expect(estimateImageTokens({ type: 'image', data: 'bm90IGFuIGltYWdl', mimeType: 'image/png' })).toBe(IMAGE_TOKEN_FALLBACK);
  });
});
