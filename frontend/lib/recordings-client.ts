// Client-side recording utilities
import pako from 'pako';

export type RRWebEvent = any;

/**
 * Decompress gzipped base64 string to events array (client-side)
 */
export function decompressEvents(compressed: string): RRWebEvent[] {
  // Convert base64 to Uint8Array
  const binaryString = atob(compressed);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Decompress
  const decompressed = pako.ungzip(bytes, { to: 'string' });
  return JSON.parse(decompressed);
}
