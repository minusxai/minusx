/**
 * Token approximation for the /debug visualization.
 *
 * Text: chars/4.
 * Images: Anthropic's (width × height) / 750 formula, capped at 1600 tokens,
 * with dimensions parsed from the base64 header (PNG IHDR / JPEG SOF). URL
 * images and unparseable payloads fall back to a flat estimate.
 */
import type { ImageContent } from '@/orchestrator/llm';
import { immutableSet } from '@/lib/utils/immutable-collections';

export const APPROX_CHARS_PER_TOKEN = 4;
/** Flat estimate for images whose dimensions can't be determined. */
export const IMAGE_TOKEN_FALLBACK = 1_000;
/** Anthropic resizes anything larger to fit ~1600 tokens. */
const IMAGE_TOKEN_MAX = 1_600;
const IMAGE_TOKEN_DIVISOR = 750;

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / APPROX_CHARS_PER_TOKEN));
}

export interface ImageDimensions {
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24) return null;
  if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Bytes 12..16 must be "IHDR"; width/height follow big-endian.
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** SOF markers that carry frame dimensions (all except DHT/DAC/RST/etc.). */
const JPEG_SOF_MARKERS = immutableSet([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (JPEG_SOF_MARKERS.has(marker)) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

/** Parse image dimensions from a base64 payload's header. Null when unknown. */
export function imageDimensionsFromBase64(base64: string, mimeType?: string): ImageDimensions | null {
  let bytes: Uint8Array;
  try {
    // Only the header is needed — decode a bounded prefix.
    const prefix = base64.slice(0, 4096);
    const binary = atob(prefix.slice(0, prefix.length - (prefix.length % 4)));
    bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  if (mimeType?.includes('png')) return pngDimensions(bytes);
  if (mimeType?.includes('jpeg') || mimeType?.includes('jpg')) return jpegDimensions(bytes);
  return pngDimensions(bytes) ?? jpegDimensions(bytes);
}

/** Approximate token cost of one image block: (w×h)/750, capped; flat fallback. */
export function estimateImageTokens(img: ImageContent): number {
  if (img.data) {
    const dims = imageDimensionsFromBase64(img.data, img.mimeType);
    if (dims) return Math.min(IMAGE_TOKEN_MAX, Math.ceil((dims.width * dims.height) / IMAGE_TOKEN_DIVISOR));
  }
  return IMAGE_TOKEN_FALLBACK;
}
