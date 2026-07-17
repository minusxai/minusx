/**
 * The image must ALWAYS ride along with the send — a message that needs an app-state screenshot is
 * never sent without it. The freeze fix is about WHERE the ~1s snapdom capture happens, not whether
 * it happens: it's pre-captured OFF the send path by the warmer, so by send time it's a cache hit.
 *
 * Contract pinned here:
 *  - appStateWithFileScreenshot (SEND) ALWAYS attaches the image. Warm → instant (no capture). Cold →
 *    it awaits the capture and attaches it (never returns an image-less app state on the happy path).
 *  - The warmer (warmFileScreenshot) pre-captures on idle so the common send is a cache hit; the
 *    blocking wait only happens on a genuinely cold cache (send right after a view change).
 *  - A changed view (different markup / query result / colorMode) invalidates the cache → re-capture.
 *  - warmFileScreenshot captures + uploads exactly once per facet, deduped across concurrent calls.
 *  - disabled / non-file app states are pass-through (no capture, no image).
 *  - A capture that THROWS is the only case that sends without an image (best-effort: a broken
 *    snapdom must not wedge the send) — it returns the app state unchanged.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  appStateWithFileScreenshot,
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
  // The warmer only fires while the user is composing a chat message (jsdom has no composer DOM);
  // default it ON so the existing "warming works" tests exercise the capture path. The gate itself
  // is covered by its own describe block below.
  _internal.chatEngaged = () => true;
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

describe('appStateWithFileScreenshot (send path — always attaches the image)', () => {
  it('awaits the capture and ATTACHES the image on a cold cache (never sends without it)', async () => {
    const app = fileAppState(1, 'dash');
    const out = await appStateWithFileScreenshot(app, 'light', false);
    expect(captureCalls).toBe(1);                       // cold → it DID capture
    expect(imageOf(out)?.url).toBe('https://cdn/1.jpg'); // …and attached the image
  });

  it('is instant on a warm cache (warmer already ran) — attaches without capturing again', async () => {
    const app = fileAppState(1, 'dash');
    warmFileScreenshot(app, 'light', false); // warmer schedules
    await runDeferred();                      // warm runs (1 capture + 1 upload) off the send path
    expect(captureCalls).toBe(1);

    const out = await appStateWithFileScreenshot(app, 'light', false); // now warm
    expect(imageOf(out)?.url).toBe('https://cdn/1.jpg');
    expect(captureCalls).toBe(1); // no re-capture for the unchanged view — the send was a cache hit
  });

  it('re-captures and swaps the image when the view changes', async () => {
    const a = fileAppState(1, 'v1');
    expect(imageOf(await appStateWithFileScreenshot(a, 'light', false))?.url).toBe('https://cdn/1.jpg');

    const b = fileAppState(1, 'v2'); // changed view → cache invalid
    const out = await appStateWithFileScreenshot(b, 'light', false);
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
    const app = fileAppState(3, 'q');
    const out = await appStateWithFileScreenshot(app, 'light', false);
    expect(imageOf(out)).toBeUndefined();
    expect(out).toBeTruthy();
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

  it('makes a subsequent send an instant cache hit (no double capture warm + send)', async () => {
    const app = fileAppState(5, 'warm-then-send');
    warmFileScreenshot(app, 'light', false);
    await runDeferred();
    expect(captureCalls).toBe(1);
    const out = await appStateWithFileScreenshot(app, 'light', false);
    expect(captureCalls).toBe(1); // send reused the warm capture
    expect(imageOf(out)?.url).toBe('https://cdn/1.jpg');
  });
});

describe('warmFileScreenshot — active-editing guard (the dashboard typing hang)', () => {
  // Typing in a dashboard text block changes `markup` every debounce tick → new shot key → the
  // warmer re-fires → a ~1s SYNCHRONOUS snapdom rasterize of the whole dashboard, over and over,
  // for the entire typing session. The warmer must NOT capture while the user is actively editing
  // inside the target view — it reschedules and captures once, after the editor blurs.
  it('does not capture while the user is editing the view; captures after editing stops', async () => {
    let editing = true;
    _internal.isEditing = () => editing;

    const app = fileAppState(11, 'typing-v1');
    warmFileScreenshot(app, 'light', false);
    await runDeferred();
    expect(captureCalls).toBe(0);        // guarded: no rasterize mid-typing
    expect(deferred.length).toBe(1);     // …but it rescheduled itself

    await runDeferred();
    expect(captureCalls).toBe(0);        // still editing → still guarded
    expect(deferred.length).toBe(1);

    editing = false;                      // user blurred the editor
    await runDeferred();
    expect(captureCalls).toBe(1);        // now it warms exactly once
  });

  it('the send path still captures fresh even mid-editing (image always rides along)', async () => {
    _internal.isEditing = () => true;
    const app = fileAppState(12, 'send-mid-edit');
    const out = await appStateWithFileScreenshot(app, 'light', false);
    expect(captureCalls).toBe(1);
    expect(imageOf(out)?.url).toBe('https://cdn/1.jpg');
  });
});

describe('warmFileScreenshot — chat-engagement gate (the "screenshots on every change" hang)', () => {
  // A rendered-view change (agent edit / query revalidation / theme toggle / GUI tweak) re-keys the
  // shot and re-fires the warmer. When the user is NOT composing a chat message, warming then is a
  // pure-waste multi-second snapdom rasterize. The warmer must only fire while a send is plausibly
  // coming (chat focused / draft present).
  it('does NOT warm when the user is not composing a chat message', async () => {
    _internal.chatEngaged = () => false;
    warmFileScreenshot(fileAppState(20, 'view-changed'), 'light', false);
    await runDeferred();
    expect(captureCalls).toBe(0);   // no speculative rasterize on a plain view change
    expect(deferred.length).toBe(0); // and nothing left scheduled
  });

  it('warms when the user IS composing (chat focused / has a draft)', async () => {
    _internal.chatEngaged = () => true;
    warmFileScreenshot(fileAppState(21, 'composing'), 'light', false);
    await runDeferred();
    expect(captureCalls).toBe(1);
  });

  it('cancels a scheduled warm if the user stops composing before it runs (re-check at run time)', async () => {
    let engaged = true;
    _internal.chatEngaged = () => engaged;
    warmFileScreenshot(fileAppState(22, 'blur-before-run'), 'light', false);
    engaged = false;                 // composer blurred / draft cleared while waiting on idle
    await runDeferred();
    expect(captureCalls).toBe(0);    // run-time re-check bails out
  });

  it('the SEND path still captures even when not composing (gate is warm-only)', async () => {
    _internal.chatEngaged = () => false;
    const out = await appStateWithFileScreenshot(fileAppState(23, 'send-no-compose'), 'light', false);
    expect(captureCalls).toBe(1);
    expect(imageOf(out)?.url).toBe('https://cdn/1.jpg');
  });
});
