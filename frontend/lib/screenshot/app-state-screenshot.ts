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
 * True while the user is genuinely COMPOSING a chat message — the chat input is focused or holds a
 * draft. Speculative warming is gated on this: the warmer's whole purpose is to have the image
 * ready for a SEND, so warming only makes sense when a send is plausibly coming. Without this gate
 * the warmer fired on EVERY rendered-view change — an agent edit landing, a query result
 * revalidating (SWR), a color-mode toggle, a GUI-builder tweak — each a synchronous multi-second
 * `snapdom` rasterize of the whole file view (measured ~4s on an 11-card dashboard). That is the
 * "every time I make changes it takes screenshots and the app hangs" bug: making changes is not
 * chatting, so with this gate those changes cost nothing. The SEND path is unaffected — it always
 * captures on demand (with the existing "preparing" indicator) so the agent always gets the image.
 */
function defaultChatEngaged(): boolean {
  if (typeof document === 'undefined') return false;
  const inputs = document.querySelectorAll('[aria-label="Chat message input"]');
  for (const el of Array.from(inputs)) {
    if (el === document.activeElement || el.contains(document.activeElement)) return true; // focused
    if ((el.textContent ?? '').trim().length > 0) return true; // holds a draft
  }
  return false;
}

/**
 * True while the user is actively editing INSIDE the target file view (focus on an input /
 * textarea / contenteditable within `[data-file-id]`, including inside a same-origin iframe —
 * the story editor). Used to hold the warmer off during a typing session: every text edit
 * changes the shot key, and rasterizing a whole dashboard (~1s, synchronous) between keystrokes
 * is the "typing on a dashboard hangs the browser" bug. Typing in the CHAT input does not focus
 * the view, so chat entry still warms normally.
 */
function defaultIsEditing(fileId: number): boolean {
  if (typeof document === 'undefined') return false;
  const view = document.querySelector(`[data-file-id="${fileId}"]`);
  if (!view) return false;
  let ae: Element | null = document.activeElement;
  if (!ae || !view.contains(ae)) return false;
  // Focus inside an iframe surfaces as the iframe element in the host document — look inside.
  for (let depth = 0; depth < 3 && ae instanceof HTMLIFrameElement; depth++) {
    let doc: Document | null = null;
    try { doc = ae.contentDocument; } catch { return false; } // cross-origin: not our editor
    ae = doc?.activeElement ?? null;
  }
  if (!ae) return false;
  const tag = ae.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (ae as HTMLElement).isContentEditable === true;
}

/**
 * Injectable seams (capture / upload / defer / isEditing) + a reset for tests. Kept as one mutable
 * object so a test can swap the browser-only capture+upload for fakes and drive the deferred warm
 * synchronously.
 */
export const _internal = {
  capture: (id: number, colorMode: ColorMode): Promise<Blob> =>
    captureFileViewBlob(id, { colorMode, maxWidth: AGENT_IMAGE_MAX_PX, format: 'jpeg' }),
  upload: (blob: Blob): Promise<string> => uploadBlobOrEmbed(blob, 'file.jpg', 'image/jpeg'),
  defer: defaultDefer as (fn: () => void) => void,
  isEditing: defaultIsEditing as (fileId: number) => boolean,
  chatEngaged: defaultChatEngaged as (fileId: number) => boolean,
  reset(): void {
    lastShot = null;
    inflightKey = null;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    this.isEditing = defaultIsEditing;
    this.chatEngaged = defaultChatEngaged;
  },
};

/**
 * Cache key for the current file view: file id + a content hash of what's rendered (markup, query
 * results, colorMode). Returns null off a file page or outside the browser (no DOM to capture).
 */
/** djb2 over a raw string — markup is the LARGEST facet and already a string, so hashing it
 *  directly skips facetHash's deep-clone + JSON re-escape of it on every app-state change
 *  (this key is recomputed per debounced keystroke while editing a dashboard). */
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
  // Only warm when a send is plausibly coming (chat focused / has a draft). Otherwise a mere view
  // change — agent edit, query revalidation, theme toggle, GUI tweak — would trigger a multi-second
  // rasterize the user never asked for. See defaultChatEngaged.
  if (!_internal.chatEngaged(info.id)) return;
  _internal.defer(() => {
    // Re-check at run time: another warm may have populated this facet while we waited on idle.
    if (lastShot?.key === info.key || inflightKey === info.key) return;
    // The user may have blurred the composer / cleared the draft while we waited on idle.
    if (!_internal.chatEngaged(info.id)) return;
    // Actively editing the view (typing in a dashboard text block / the story editor): the view is
    // churning and a synchronous ~1s rasterize NOW would hang the typing session. Reschedule; the
    // warm lands once the editor blurs. (The SEND path is unaffected — it always captures fresh.)
    if (_internal.isEditing(info.id)) {
      warmFileScreenshot(appState, colorMode, disabled);
      return;
    }
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
