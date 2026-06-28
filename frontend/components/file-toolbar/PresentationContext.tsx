'use client';

/**
 * PresentationContext — generic, file-type-agnostic "Present" (fullscreen) mode.
 *
 * One FileView subtree (its shared header + the type-specific content) is wrapped
 * in a single element; entering presentation requests the native Fullscreen API on
 * that element so it fills the screen (browser/OS chrome hidden) while the right
 * sidebar / breadcrumb — which live OUTSIDE FileView — drop away for a focused view.
 *
 * Why native fullscreen (not an in-app overlay): zero double-mounting of the content
 * (no duplicate iframes, query subscriptions, or `data-file-id` capture nodes), ESC
 * exits for free, and it reads as a real presentation. The content components already
 * own their max-width/reading layout, so the shared layer only needs the toggle.
 *
 * The header reads `usePresentation()` to render the Present toggle; any view can read
 * `isPresenting` to adapt its own layout (e.g. the notebook switches to its reading
 * layout while presenting).
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

export interface PresentationContextValue {
  /** Whether this file is currently presented fullscreen. */
  isPresenting: boolean;
  /** Whether the Fullscreen API is available — when false, hide the Present affordance. */
  supported: boolean;
  /** Enter/exit presentation. Entering MUST be triggered from a user gesture. */
  toggle: () => void;
}

const PresentationContext = createContext<PresentationContextValue | null>(null);

// External-store wiring for the native Fullscreen API. useSyncExternalStore keeps
// React in sync without effects and is SSR-safe (getServerSnapshot → false), so
// there's no hydration mismatch and no setState-in-effect.
const subscribeFullscreen = (cb: () => void) => {
  document.addEventListener('fullscreenchange', cb);
  return () => document.removeEventListener('fullscreenchange', cb);
};
const noSubscribe = () => () => {};
const serverFalse = () => false;

export function PresentationProvider({ children, fileType }: { children: ReactNode; fileType?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const isPresenting = useSyncExternalStore(
    subscribeFullscreen,
    () => document.fullscreenElement === containerRef.current,
    serverFalse,
  );
  const supported = useSyncExternalStore(
    noSubscribe,
    () => Boolean(document.fullscreenEnabled),
    serverFalse,
  );

  const toggle = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      void el.requestFullscreen?.();
    }
  }, []);

  const value = useMemo<PresentationContextValue>(
    () => ({ isPresenting, supported, toggle }),
    [isPresenting, supported, toggle],
  );

  return (
    <PresentationContext.Provider value={value}>
      {/* The presentable surface: header + content. flex column so height propagates
          to content that fills the page (dashboards/questions). While presenting it
          becomes the viewport-sized scroll container (overflowY:auto, inline so it
          reliably applies). The canvas bg — colormode-aware so the dark title text
          stays readable — is set in globals.css keyed off `[data-presenting]` and the
          html `.dark` class (an ancestor, so it still applies in the top layer). */}
      <div
        ref={containerRef}
        data-presentation-surface=""
        data-presenting={isPresenting ? 'true' : undefined}
        data-file-type={fileType}
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: '1 1 0%',
          minHeight: 0,
          ...(isPresenting ? { overflowY: 'auto' } : null),
        }}
      >
        {children}
      </div>
    </PresentationContext.Provider>
  );
}

/** Returns the presentation controls, or null when rendered outside a provider. */
export function usePresentation(): PresentationContextValue | null {
  return useContext(PresentationContext);
}
