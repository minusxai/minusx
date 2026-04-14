'use client';

/**
 * DashboardPublishHighlights — context that marks question widgets in a dashboard
 * preview as added or repositioned during the PublishModal review flow.
 *
 * Consuming components (DashboardView) read from this context to apply colored
 * borders identical in style to the param-hover highlighting, without any prop drilling
 * through FileView's registry pattern.
 */
import { createContext, useContext } from 'react';

export type PublishHighlight = 'added' | 'moved';

interface DashboardPublishHighlightsValue {
  /** question ID → highlight type; null means context is inactive (normal view) */
  highlights: Map<number, PublishHighlight> | null;
}

export const DashboardPublishHighlightsContext = createContext<DashboardPublishHighlightsValue>({
  highlights: null,
});

export function useDashboardPublishHighlights() {
  return useContext(DashboardPublishHighlightsContext);
}
