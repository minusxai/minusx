/**
 * Screenshot system TypeScript interfaces
 */

export interface ScreenshotOptions {
  pixelRatio?: number;         // Raster scale of the CSS box (default: 0.75); on region captures it is the device cap instead
  maxWidth?: number;           // Cap output width in px; pixelRatio is derived automatically
  /**
   * Cap output HEIGHT in px. Combined with maxWidth by taking whichever cap binds tighter, so the
   * FULL element still fits in the output (downscaled, never cropped). Used by full-height agent
   * captures, where a tall page would otherwise rasterize at maxWidth × thousands of px.
   */
  maxHeight?: number;
  backgroundColor?: string;    // Background color
  quality?: number;            // JPEG quality (0-1, default: AGENT_IMAGE_JPEG_QUALITY = 0.85)
  format?: 'png' | 'jpeg';     // Output format (default: 'jpeg')
  filter?: (el: Element) => boolean; // Node filter (return true to keep) — applied to the clone in the serializer
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
