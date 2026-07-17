'use client';

import { createContext, useContext } from 'react';

/**
 * True inside a canvas-rendered story's embed islands. Consumers that can draw to
 * either DOM or canvas switch to canvas-native output here — e.g. VegaChart uses
 * vega's canvas renderer instead of SVG, so captures can read chart pixels
 * STRAIGHT OFF the chart's own canvas (no DOM serialization of any kind).
 */
export const CanvasRenderContext = createContext(false);

export function useInCanvasStory(): boolean {
  return useContext(CanvasRenderContext);
}
