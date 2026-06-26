/**
 * Screenshot system TypeScript interfaces
 */

export interface ScreenshotOptions {
  pixelRatio?: number;         // Retina scaling (default: 2)
  maxWidth?: number;           // Cap output width in px; pixelRatio is derived automatically
  backgroundColor?: string;    // Background color
  quality?: number;            // JPEG quality (0-1, default: 1.0)
  format?: 'png' | 'jpeg';     // Output format (default: 'png')
  filter?: (el: Element) => boolean; // Node filter (return true to keep) — matches snapdom's signature
}

export interface ScreenshotResult {
  blob: Blob;
  dataURL: string;
  timestamp: string;
}
