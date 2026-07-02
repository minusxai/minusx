/**
 * The send path must NOT block on the ~1s snapdom capture (that froze the page on Enter).
 *
 * Contract pinned here:
 *  - appStateWithFileScreenshot (SEND) is synchronous & non-blocking: on a COLD cache it returns the
 *    app state unchanged WITHOUT calling capture inline, and schedules a background warm.
 *  - Once warm, the same view attaches the cached image with NO further capture (cross-turn dedup).
 *  - A changed view (different markup / query result / colorMode) invalidates the cache.
 *  - warmFileScreenshot captures + uploads exactly once per facet, deduped across concurrent calls.
 *  - appStateWithFileScreenshotBlocking awaits the capture (for the context-size estimate).
 *  - disabled / non-file app states are pass-through (no capture).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  appStateWithFileScreenshot,
  appStateWithFileScreenshotBlocking,
  warmFileScreenshot,
  appStateShotKey,
  _internal,
} from '@/lib/screenshot/app-state-screenshot';
import type { AppState } from '@/lib/appState';

// A minimal file app state; `markup` + `queryResults` drive the cache key.
function fileAppState(id: number, markup: string, qr: unknown = {}): AppState {
  return {
    type: 'file',
    state: { fileState: { id, markup }, queryResults: qr } as any,
  } as AppState;
}

let captureCalls = 0;
let uploadCalls = 0;
let deferred: Array<() => void> = [];

beforeEach(() => {
  _internal.reset();
  captureCalls = 0;
  uploadCalls = 0;
  deferred = [];
  // Capture is the ~1s blocker in production — here it's a fake we can count.
  _internal.capture = vi.fn(async () => {
    captureCalls++;
    return new Blob(['x'], { type: 'image/jpeg' });
  });
  _internal.upload = vi.fn(async () => {
    uploadCalls++;
    return `https://cdn/${captureCalls}.jpg`;
  });
  // Run deferred warms manually so the test controls timing (no real timers/idle).
  _internal.defer = (fn: () => void) => { deferred.push(fn); };
});

const runDeferred = async () => {
  const fns = deferred;
  deferred = [];
  for (const fn of fns) fn();
  // let the async capture/upload chain settle
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const imageOf = (a: AppState | null | undefined): { key: string; url: string } | undefined =>
  (a as any)?.state?.fileState?.image;

describe('appStateShotKey', () => {
  it('is stable for the same view and changes when the view changes', () => {
    const k1 = appStateShotKey(fileAppState(7, 'M', { a: 1 }), 'light');
    const k2 = appStateShotKey(fileAppState(7, 'M', { a: 1 }), 'light');
    expect(k1?.key).toBe(k2?.key);
    expect(k1?.id).toBe(7);
    expect(appStateShotKey(fileAppState(7, 'M2', { a: 1 }), 'light')?.key).not.toBe(k1?.key);
    expect(appStateShotKey(fileAppState(7, 'M', { a: 2 }), 'light')?.key).not.toBe(k1?.key);
    expect(appStateShotKey(fileAppState(7, 'M', { a: 1 }), 'dark')?.key).not.toBe(k1?.key);
  });

  it('returns null for non-file / empty app states', () => {
    expect(appStateShotKey({ type: 'explore', state: null } as AppState, 'light')).toBeNull();
    expect(appStateShotKey(null, 'light')).toBeNull();
  });
});

describe('appStateWithFileScreenshot (send path, non-blocking)', () => {
  it('does NOT capture inline on a cold cache and returns the app state unchanged', () => {
    const app = fileAppState(1, 'dash');
    const out = appStateWithFileScreenshot(app, 'light', false);
    expect(captureCalls).toBe(0);         // the freeze fix: no ~1s snapdom on Enter
    expect(imageOf(out)).toBeUndefined(); // no image yet (cache cold)
    expect(deferred.length).toBe(1);      // but a background warm was scheduled
  });

  it('attaches the cached image once warm, without capturing again', async () => {
    const app = fileAppState(1, 'dash');
    appStateWithFileScreenshot(app, 'light', false); // schedules warm
    await runDeferred();                              // warm runs (1 capture + 1 upload)
    expect(captureCalls).toBe(1);

    const out = appStateWithFileScreenshot(app, 'light', false); // now warm
    expect(imageOf(out)?.url).toBe('https://cdn/1.jpg');
    expect(captureCalls).toBe(1); // no re-capture for the unchanged view
  });

  it('re-warms (and swaps the image) when the view changes', async () => {
    const a = fileAppState(1, 'v1');
    appStateWithFileScreenshot(a, 'light', false);
    await runDeferred();
    expect(imageOf(appStateWithFileScreenshot(a, 'light', false))?.url).toBe('https://cdn/1.jpg');

    const b = fileAppState(1, 'v2'); // changed view
    const coldB = appStateWithFileScreenshot(b, 'light', false);
    expect(imageOf(coldB)).toBeUndefined(); // cold again for the new view
    await runDeferred();
    expect(captureCalls).toBe(2);
    expect(imageOf(appStateWithFileScreenshot(b, 'light', false))?.url).toBe('https://cdn/2.jpg');
  });

  it('is a pass-through when disabled or on a non-file page (no capture, no warm)', () => {
    expect(appStateWithFileScreenshot(fileAppState(1, 'd'), 'light', true)).toBeTruthy();
    appStateWithFileScreenshot({ type: 'explore', state: null } as AppState, 'light', false);
    expect(captureCalls).toBe(0);
    expect(deferred.length).toBe(0);
  });
});

describe('warmFileScreenshot dedup', () => {
  it('captures once per facet even if scheduled many times before it runs', async () => {
    const app = fileAppState(9, 'same');
    warmFileScreenshot(app, 'light', false);
    warmFileScreenshot(app, 'light', false);
    warmFileScreenshot(app, 'light', false);
    await runDeferred();
    expect(captureCalls).toBe(1);
    expect(uploadCalls).toBe(1);
  });

  it('does nothing when disabled', async () => {
    warmFileScreenshot(fileAppState(9, 'same'), 'light', true);
    await runDeferred();
    expect(captureCalls).toBe(0);
  });
});

describe('appStateWithFileScreenshotBlocking (context-size path)', () => {
  it('awaits the capture and attaches the image on a cold cache', async () => {
    const out = await appStateWithFileScreenshotBlocking(fileAppState(3, 'q'), 'light', false);
    expect(captureCalls).toBe(1);
    expect(imageOf(out)?.url).toBe('https://cdn/1.jpg');
  });

  it('reuses the warm cache with no extra capture', async () => {
    const app = fileAppState(3, 'q');
    await appStateWithFileScreenshotBlocking(app, 'light', false);
    const out = await appStateWithFileScreenshotBlocking(app, 'light', false);
    expect(captureCalls).toBe(1);
    expect(imageOf(out)?.url).toBe('https://cdn/1.jpg');
  });

  it('returns the app state unchanged if capture throws', async () => {
    _internal.capture = vi.fn(async () => { throw new Error('snapdom failed'); });
    const app = fileAppState(3, 'q');
    const out = await appStateWithFileScreenshotBlocking(app, 'light', false);
    expect(imageOf(out)).toBeUndefined();
    expect(out).toBeTruthy();
  });
});
