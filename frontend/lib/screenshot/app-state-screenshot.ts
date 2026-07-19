/**
 * App-state screenshot attachment — turns the current file view into an image the agent can "see",
 * captured LAZILY, only when it's actually needed (on send), with a one-slot cache so an unchanged
 * view is never re-captured.
 *
 * WHY LAZY (the freeze fix): `snapdom` rasterizes the whole file view SYNCHRONOUSLY on the main
 * thread — measured ~4s on an 11-card dashboard, more on bigger ones. The app used to *warm* this
 * speculatively on every rendered-view change (agent edit, query revalidation, theme toggle, GUI
 * tweak) so the eventual send would be instant. But that meant the main thread froze for seconds
 * whenever the view changed — including WHILE the user was editing or typing — for an image that
 * was often never sent. That is the "every time I make changes it takes screenshots and hangs" bug.
 *
 * The fix: capture ONLY on send, when the image is genuinely needed. Nothing runs on view changes,
 * so editing / typing / query revalidation / theme toggles never pay a capture. The one-slot cache
 * (`lastShot`, keyed by file id + rendered facet) still makes repeated sends of an unchanged view a
 * cache hit. The unavoidable snapdom cost is paid once, at the moment of send — a user-initiated
 * action shown with the existing "preparing" indicator — never speculatively.
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

/**
 * Injectable seams (capture / upload) + a reset for tests. Kept as one mutable object so a test can
 * swap the browser-only capture+upload for fakes.
 */
export const _internal = {
  capture: (id: number, colorMode: ColorMode, markers: boolean): Promise<Blob> =>
    captureFileViewBlob(id, { colorMode, maxWidth: AGENT_IMAGE_MAX_PX, format: 'jpeg', markers }),
  upload: (blob: Blob): Promise<string> => uploadBlobOrEmbed(blob, 'file.jpg', 'image/jpeg'),
  reset(): void {
    lastShot = null;
  },
};

/**
 * Whether the app-state file view gets position markers + a `<Viewport>` pointer. STORY-ONLY for now:
 * a story renders at its full height in the page, so `offsetHeight` is the whole document and the
 * scroll pointer is meaningful. Questions/dashboards/notebooks can have internal scroll or a fixed
 * height (offsetHeight = visible slice), which would peg the pointer at "section 1" and number only
 * the visible part — so they're excluded until their scroll model is handled. Shared by the capture
 * (markers) and the send path (pointer) so both gate identically.
 */
export function isStoryAppState(appState: AppState | null | undefined): boolean {
  return appState?.type === 'file'
    && (appState.state as { fileState?: { type?: string } } | undefined)?.fileState?.type === 'story';
}

/**
 * Cache key for the current file view: file id + a content hash of what's rendered (markup, query
 * results, colorMode). Returns null off a file page or outside the browser (no DOM to capture).
 */
/** djb2 over a raw string — markup is the LARGEST facet and already a string, so hashing it
 *  directly skips facetHash's deep-clone + JSON re-escape of it. */
function strHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export function appStateShotKey(
  appState: AppState | null | undefined,
  colorMode: ColorMode,
): { id: number; key: string } | null {
  if (typeof document === 'undefined') return null;
  if (!appState || appState.type !== 'file') return null;
  const state = appState.state as { fileState?: { id?: number; markup?: unknown }; queryResults?: unknown } | undefined;
  const fs = state?.fileState;
  if (!fs?.id) return null;
  const markupHash = typeof fs.markup === 'string' ? strHash(fs.markup) : facetHash(fs.markup ?? null);
  const key = `file:${fs.id}:${markupHash}:${facetHash({ qr: state?.queryResults, colorMode })}`;
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
  const blob = await _internal.capture(info.id, colorMode, isStoryAppState(appState));
  const url = await _internal.upload(blob);
  lastShot = { key: info.key, url };
  return url;
}

/**
 * SEND path — the ONLY place a capture happens. Always attaches the image so the agent can see the
 * view. A cache hit (same view sent again) is instant; otherwise it captures now — the caller shows
 * the "preparing" indicator during that brief wait. The only image-less result is a capture that
 * throws: a broken snapdom must not wedge the send, so we fall back to sending without the image.
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
