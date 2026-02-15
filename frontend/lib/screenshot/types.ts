/**
 * Screenshot system TypeScript interfaces
 */

export interface ScreenshotOptions {
  pixelRatio?: number;         // Retina scaling (default: 2)
  backgroundColor?: string;    // Background color
  quality?: number;            // JPEG quality (0-1, default: 1.0)
  format?: 'png' | 'jpeg';     // Output format (default: 'png')
  filter?: (node: HTMLElement) => boolean; // Element filter
}

export interface ScreenshotResult {
  blob: Blob;
  dataURL: string;
  timestamp: string;
}
