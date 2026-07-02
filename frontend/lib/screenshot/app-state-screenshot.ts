/**
 * App-state screenshot attachment — the single source for turning the current file view into an
 * image the agent can "see", with a cross-turn cache keyed by what's rendered.
 *
 * WHY THIS EXISTS (the freeze fix): `snapdom.toBlob()` rasterizes the whole file view synchronously
 * on the main thread — measured at ~1s for a 25-widget dashboard. The problem was never that we
 * capture; the image MUST ride along with the send (the agent needs to see the view). The problem
 * was WHERE the ~1s cost was paid: it used to be paid *on every keystroke's worth of* send handling,
 * making typing + Enter stutter.
 *
 * The fix moves the cost OFF the critical path without ever dropping the image:
 *  - {@link warmFileScreenshot} captures + uploads on idle (debounced), keyed to the rendered view.
 *    Typing in chat does not change the rendered view, so the warmer never re-fires on keystrokes —
 *    that's what keeps text entry smooth. By send time the cache is almost always already warm.
 *  - {@link appStateWithFileScreenshot} (SEND path) ALWAYS attaches the image. Warm cache → instant.
 *    Cold cache (send right after a view change, before the warmer finished) → it awaits the capture
 *    so the image is still attached; the UI shows the existing "preparing" indicator during that
 *    brief, rare wait. The message is never sent without the image on the happy path.
 *
 * The cache is a single module-level slot keyed by `file id + facetHash(markup, queryResults,
 * colorMode)` — an unchanged view is never re-captured, and a changed view invalidates it.
 */
import type { AppState } from '@/lib/appState';
import { captureFileViewBlob } from './capture';
import { AGENT_IMAGE_MAX_PX } from './constants';
import { uploadBlobOrEmbed } from '@/lib/object-store/client';
import { facetHash } from '@/lib/projection/facets';

export type ColorMode = 'light' | 'dark';

interface Shot {
  key: string;
  url: string;
}

let lastShot: Shot | null = null;
let inflightKey: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Default off-critical-path scheduler: debounce bursts, then run on browser idle. */
function defaultDefer(fn: () => void): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const ric = typeof window !== 'undefined' ? (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
    }).requestIdleCallback : undefined;
    if (ric) ric(fn, { timeout: 2000 });
    else fn();
  }, 400);
}

/**
 * Injectable seams (capture / upload / defer) + a reset for tests. Kept as one mutable object so a
 * test can swap the browser-only capture+upload for fakes and drive the deferred warm synchronously.
 */
export const _internal = {
  capture: (id: number, colorMode: ColorMode): Promise<Blob> =>
    captureFileViewBlob(id, { colorMode, maxWidth: AGENT_IMAGE_MAX_PX, format: 'jpeg' }),
  upload: (blob: Blob): Promise<string> => uploadBlobOrEmbed(blob, 'file.jpg', 'image/jpeg'),
  defer: defaultDefer as (fn: () => void) => void,
  reset(): void {
    lastShot = null;
    inflightKey = null;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
  },
};

/**
 * Cache key for the current file view: file id + a content hash of what's rendered (markup, query
 * results, colorMode). Returns null off a file page or outside the browser (no DOM to capture).
 */
export function appStateShotKey(
  appState: AppState | null | undefined,
  colorMode: ColorMode,
): { id: number; key: string } | null {
  if (typeof document === 'undefined') return null;
  if (!appState || appState.type !== 'file') return null;
  const state = appState.state as { fileState?: { id?: number; markup?: unknown }; queryResults?: unknown } | undefined;
  const fs = state?.fileState;
  if (!fs?.id) return null;
  const key = `file:${fs.id}:${facetHash({ markup: fs.markup, qr: state?.queryResults, colorMode })}`;
  return { id: fs.id, key };
}

/** Overlay `{ image: { key, url } }` onto the file state without mutating the input. */
function attachImage(appState: AppState, key: string, url: string): AppState {
  const state = appState.state as { fileState?: unknown };
  return {
    ...appState,
    state: { ...state, fileState: { ...(state.fileState as object), image: { key, url } } },
  } as AppState;
}

/** Capture + upload for the current view, populating the cache. Cache hit → instant. */
async function captureNow(appState: AppState, colorMode: ColorMode): Promise<string | null> {
  const info = appStateShotKey(appState, colorMode);
  if (!info) return null;
  if (lastShot?.key === info.key) return lastShot.url;
  const blob = await _internal.capture(info.id, colorMode);
  const url = await _internal.upload(blob);
  lastShot = { key: info.key, url };
  return url;
}

/**
 * Warm the cache OFF the critical path (debounced + on idle). Deduped by facet key: already-warm or
 * in-flight facets are skipped, so scheduling it repeatedly (send path + view-change effect) is
 * cheap. This is where the ~1s snapdom cost is paid — during idle time, not on Enter.
 */
export function warmFileScreenshot(
  appState: AppState | null | undefined,
  colorMode: ColorMode,
  disabled: boolean,
): void {
  if (disabled) return;
  const info = appStateShotKey(appState, colorMode);
  if (!info) return;
  if (lastShot?.key === info.key || inflightKey === info.key) return;
  _internal.defer(() => {
    // Re-check at run time: another warm may have populated this facet while we waited on idle.
    if (lastShot?.key === info.key || inflightKey === info.key) return;
    inflightKey = info.key;
    captureNow(appState as AppState, colorMode)
      .catch(() => { /* best-effort: a missed screenshot just means no image this turn */ })
      .finally(() => { if (inflightKey === info.key) inflightKey = null; });
  });
}

/**
 * SEND path — ALWAYS attaches the image. A warm cache (the common case, thanks to the warmer) makes
 * this instant. A cold cache (send right after a view change) awaits the capture so the image is
 * still attached rather than dropped — the caller shows the "preparing" indicator during that brief
 * wait. The only path that returns image-less is a capture that throws: a broken snapdom must not
 * wedge the send forever, so we fall back to sending without the image.
 */
export async function appStateWithFileScreenshot(
  appState: AppState | null | undefined,
  colorMode: ColorMode,
  disabled: boolean,
): Promise<AppState | null | undefined> {
  if (disabled) return appState;
  const info = appStateShotKey(appState, colorMode);
  if (!info) return appState;
  try {
    const url = lastShot?.key === info.key ? lastShot.url : await captureNow(appState as AppState, colorMode);
    return url ? attachImage(appState as AppState, info.key, url) : appState;
  } catch {
    return appState;
  }
}
