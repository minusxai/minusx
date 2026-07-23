'use client';

/**
 * The dashboard surface's measured width, provided by DashboardSurface to the view tree inside
 * the iframe (Renderer_v2 Phase 8).
 *
 * Why this exists: react-grid-layout's `WidthProvider` measures through resize-observer-polyfill
 * — a PURE polyfill whose refresh triggers (top-document mutations/transitions/window resize)
 * never fire for elements inside the surface's iframe document. It measures once at mount and
 * goes deaf: pane toggles left the grid laid out at a stale width, clipped at the pane edge.
 * The surface already tracks its width authoritatively (autoSizeStorySurface + the host's
 * ResizeObserver on the iframe element — a top-document target, natively reliable), so the grid
 * consumes THAT width instead of re-deriving it through a realm-bound observer.
 */
import { createContext, useContext } from 'react';

export const SurfaceWidthContext = createContext<number | null>(null);

/** The surface's current width in CSS px, or null outside a surface (jsdom, legacy mounts). */
export function useSurfaceWidth(): number | null {
  return useContext(SurfaceWidthContext);
}
