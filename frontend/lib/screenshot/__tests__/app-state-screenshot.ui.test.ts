/**
 * The app-state screenshot is captured LAZILY — ONLY on send, when the image is actually needed.
 * There is no speculative warming: a synchronous multi-second snapdom rasterize must never fire on
 * a view change (agent edit / query revalidation / theme toggle / GUI tweak) while the user edits
 * or types. That was the "every time I make changes it takes screenshots and the app hangs" bug.
 *
 * Contract pinned here:
 *  - appStateWithFileScreenshot (SEND) is the ONLY capture path. It always attaches the image.
 *  - A cache hit (same view sent again) is instant — no re-capture.
 *  - A changed view (different markup / query result / colorMode) invalidates the cache → re-capture.
 *  - disabled / non-file app states are pass-through (no capture, no image).
 *  - A capture that THROWS is the only case that sends without an image (best-effort: a broken
 *    snapdom must not wedge the send) — it returns the app state unchanged.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  appStateWithFileScreenshot,
  appStateShotKey,
  markersEnabledForAppState,
  _internal,
} from '@/lib/screenshot/app-state-screenshot';
import { FILE_TYPE_METADATA } from '@/lib/ui/file-metadata';
import type { AppState } from '@/lib/appState';

const storyAppState = (id: number, markup = 'm'): AppState =>
  ({ type: 'file', state: { fileState: { id, type: 'story', markup }, queryResults: {} } } as unknown as AppState);

// A minimal file app state; `markup` + `queryResults` drive the cache key.
function fileAppState(id: number, markup: string, qr: unknown = {}): AppState {
  return {
    type: 'file',
    state: { fileState: { id, markup }, queryResults: qr } as any,
  } as AppState;
}

let captureCalls = 0;
let uploadCalls = 0;

beforeEach(() => {
  _internal.reset();
  captureCalls = 0;
  uploadCalls = 0;
  // Capture is the multi-second blocker in production — here it's a fake we can count.
  _internal.capture = vi.fn(async () => {
    captureCalls++;
    return { blob: new Blob(['x'], { type: 'image/jpeg' }), readiness: { settled: true, busyCount: 0 } };
  });
  _internal.upload = vi.fn(async () => {
    uploadCalls++;
    return `https://cdn/${captureCalls}.jpg`;
  });
});

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

describe('appStateWithFileScreenshot (the ONLY capture path — lazy, on send)', () => {
  it('captures on send and attaches the image', async () => {
    const out = await appStateWithFileScreenshot(fileAppState(1, 'dash'), 'light', false);
    expect(captureCalls).toBe(1);
    expect(uploadCalls).toBe(1);
    expect(imageOf(out)?.url).toBe('https://cdn/1.jpg');
  });

  it('sending the SAME view again is a cache hit — no second capture', async () => {
    const app = fileAppState(1, 'dash');
    await appStateWithFileScreenshot(app, 'light', false);
    const out = await appStateWithFileScreenshot(app, 'light', false);
    expect(captureCalls).toBe(1); // reused the cache
    expect(imageOf(out)?.url).toBe('https://cdn/1.jpg');
  });

  it('re-captures and swaps the image when the view changes', async () => {
    expect(imageOf(await appStateWithFileScreenshot(fileAppState(1, 'v1'), 'light', false))?.url).toBe('https://cdn/1.jpg');
    const out = await appStateWithFileScreenshot(fileAppState(1, 'v2'), 'light', false);
    expect(captureCalls).toBe(2);
    expect(imageOf(out)?.url).toBe('https://cdn/2.jpg');
  });

  it('is a pass-through when disabled or on a non-file page (no capture, no image)', async () => {
    const disabled = await appStateWithFileScreenshot(fileAppState(1, 'd'), 'light', true);
    expect(imageOf(disabled)).toBeUndefined();
    const nonFile = await appStateWithFileScreenshot({ type: 'explore', state: null } as AppState, 'light', false);
    expect(imageOf(nonFile)).toBeUndefined();
    expect(captureCalls).toBe(0);
  });

  it('sends WITHOUT an image only if capture throws (a broken snapdom must not wedge the send)', async () => {
    _internal.capture = vi.fn(async () => { throw new Error('snapdom failed'); });
    const out = await appStateWithFileScreenshot(fileAppState(3, 'q'), 'light', false);
    expect(imageOf(out)).toBeUndefined();
    expect(out).toBeTruthy();
  });

  it('a MID-LOAD capture (readiness not settled) is sent but never cached — the next send recaptures', async () => {
    // The cache key hashes content + query results, which may not change again once the pending
    // renders finish — caching a spinner shot would re-send it for every later message.
    _internal.capture = vi.fn(async () => {
      captureCalls++;
      return { blob: new Blob(['x'], { type: 'image/jpeg' }), readiness: { settled: false, busyCount: 2 } };
    });
    const app = fileAppState(4, 'story');
    const first = await appStateWithFileScreenshot(app, 'light', false);
    expect(imageOf(first)?.url).toBe('https://cdn/1.jpg'); // still attached (true at send time)
    await appStateWithFileScreenshot(app, 'light', false);
    expect(captureCalls).toBe(2); // no cache hit for the unsettled shot
  });
});

// Markers are gated by ONE declared flag in FILE_TYPE_METADATA (Renderer_v2 §2b), replacing the
// old story-only isStoryAppState check. Full-flow document types are flagged; internally-scrolled
// (question) and admin/form types (connection/context — h:'none' but NOT rendered documents, the
// over-match review finding) are not.
describe('position markers gate on FILE_TYPE_METADATA.markers', () => {
  const typedAppState = (type: string): AppState =>
    ({ type: 'file', state: { fileState: { id: 1, type, markup: 'm' }, queryResults: {} } } as unknown as AppState);

  it('is true for every flagged document type', () => {
    for (const t of ['story', 'dashboard', 'notebook', 'report', 'alert', 'alert_run', 'report_run']) {
      expect(markersEnabledForAppState(typedAppState(t)), t).toBe(true);
    }
  });

  it('is false for internally-scrolled, admin, unverified-rendering, and non-file states', () => {
    for (const t of ['question', 'connection', 'context', 'context_run', 'config', 'users', 'folder']) {
      expect(markersEnabledForAppState(typedAppState(t)), t).toBe(false);
    }
    expect(markersEnabledForAppState(fileAppState(1, 'm'))).toBe(false); // no type
    expect(markersEnabledForAppState({ type: 'explore', state: null } as AppState)).toBe(false);
    expect(markersEnabledForAppState(null)).toBe(false);
  });

  it('INVARIANT: every flagged type is h:\'none\' — markers on an internally-scrolled view would be wrong by construction', () => {
    for (const [type, meta] of Object.entries(FILE_TYPE_METADATA)) {
      if ((meta as { markers?: boolean }).markers) {
        expect(meta.h, `${type} is flagged for markers but not full-flow`).toBe('none');
      }
    }
  });

  it('conversation is GONE from FILE_TYPE_METADATA (not a file type since the v3 chat migration)', () => {
    expect('conversation' in FILE_TYPE_METADATA).toBe(false);
  });

  it('requests the marker gutter for flagged captures but not for unflagged file views', async () => {
    await appStateWithFileScreenshot(storyAppState(1), 'light', false);
    expect((_internal.capture as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[2]).toBe(true);
    _internal.reset();
    await appStateWithFileScreenshot(typedAppState('dashboard'), 'light', false);
    expect((_internal.capture as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[2]).toBe(true);
    _internal.reset();
    await appStateWithFileScreenshot(typedAppState('question'), 'light', false);
    expect((_internal.capture as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[2]).toBe(false);
  });
});

describe('no speculative capture', () => {
  it('the module exports no warmer — capturing is send-only', async () => {
    const mod = await import('@/lib/screenshot/app-state-screenshot');
    expect((mod as Record<string, unknown>).warmFileScreenshot).toBeUndefined();
  });

  it('merely computing shot keys for changing views never captures', () => {
    appStateShotKey(fileAppState(9, 'v1'), 'light');
    appStateShotKey(fileAppState(9, 'v2'), 'light');
    appStateShotKey(fileAppState(9, 'v3'), 'dark');
    expect(captureCalls).toBe(0);
  });
});
