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
  /**
   * Draw the numbered position-marker gutter down the left edge of a FULL-element capture (see
   * lib/screenshot/draw-markers.ts). Opt-in: ONLY the agent's app-state screenshot sets this — OG
   * share previews, the Screenshot tool, and Dev-Tools downloads use the same capture path and must
   * stay clean. Ignored by region/crop captures.
   */
  markers?: boolean;
}

export interface ScreenshotResult {
  blob: Blob;
  dataURL: string;
  timestamp: string;
}
